import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArtifact, parseXmlTree, StreamingArtifactParser } from '../shared/artifact-parser.js';

const sample = `<artifact title="Demo"><message>Created it.</message><file path="src/App.jsx">\nexport default function App() { return <main title="hi">Hello</main>; }\n</file><file path="src/styles.css">\nh1 { color: tomato; }\n</file><delete path="src/old.css"/></artifact>`;

test('recursive XML parser preserves raw JSX and builds tree', () => {
  const tree = parseXmlTree(sample);
  assert.equal(tree.name, 'artifact');
  assert.equal(tree.children.length, 4);
  assert.match(tree.children[1].text, /<main title="hi">/);
  const parsed = parseArtifact(sample);
  assert.equal(parsed.title, 'Demo');
  assert.deepEqual(parsed.actions.map((a) => a.type), ['message', 'file', 'file', 'delete']);
});

test('streaming parser works with arbitrary byte boundaries', () => {
  for (const size of [1, 2, 7, 26, 99, 5000]) {
    const p = new StreamingArtifactParser();
    let actions = [];
    for (let i = 0; i < sample.length; i += size) actions = actions.concat(p.push(sample.slice(i, i + size)));
    p.finish();
    assert.equal(actions.length, 4, `chunk size ${size}`);
    assert.match(actions[1].content, /Hello<\/main>/);
    assert.equal(actions[3].path, 'src/old.css');
  }
});

test('rejects path traversal from LLM output', () => {
  assert.throws(() => parseArtifact('<artifact><file path="../secret">x</file></artifact>'), /Invalid generated path/);
  assert.throws(() => parseArtifact('<artifact><delete path=".env"/></artifact>'), /Invalid generated path/);
});

test('rejects incomplete streams and malformed XML', () => {
  const p = new StreamingArtifactParser();
  p.push('<artifact title="A"><file path="src/App.jsx">half');
  assert.throws(() => p.finish(), /Incomplete artifact/);
  assert.throws(() => parseXmlTree('<artifact><message>hello</artifact>'), /Unclosed message/);
});

test('retains raw angle brackets and comments within source files', () => {
  const code = `const x = 3 < 5; // do not convert <div> into a node`;
  const parsed = parseArtifact(`<artifact><file path="src/check.js">${code}</file></artifact>`);
  assert.equal(parsed.actions[0].content, code + '\n'.slice(1));
});
