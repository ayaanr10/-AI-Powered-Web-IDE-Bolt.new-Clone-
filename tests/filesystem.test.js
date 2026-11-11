import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, safePath, toMountTree, validateFiles, languageFor } from '../shared/filesystem.js';

test('only safe relative paths are accepted', () => {
  for (const p of ['src/App.jsx', 'package.json', 'src/components/Card.jsx']) assert.equal(safePath(p), true);
  for (const p of ['', '/etc/passwd', 'src/../.env', 'src\\main.js', 'node_modules/evil.js', '.env.local', 'src//a']) assert.equal(safePath(p), false, p);
});

test('file and deletion operations are immutable', () => {
  const a = { 'src/a.js': 'a' };
  const b = applyAction(a, { type: 'file', path: 'src/b.js', content: 'b' });
  assert.deepEqual(a, { 'src/a.js': 'a' });
  assert.deepEqual(b, { 'src/a.js': 'a', 'src/b.js': 'b' });
  assert.deepEqual(applyAction(b, { type: 'delete', path: 'src/a.js' }), { 'src/b.js': 'b' });
});

test('WebContainer mount tree has nested folders with file contents', () => {
  const tree = toMountTree({ 'src/components/Card.jsx': '<Card/>', 'package.json': '{}' });
  assert.equal(tree.src.directory.components.directory['Card.jsx'].file.contents, '<Card/>');
  assert.equal(tree['package.json'].file.contents, '{}');
});

test('limits project size, count, and individual file size', () => {
  assert.throws(() => validateFiles(Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`file${i}.js`, 'x']))), /Too many files/);
  assert.throws(() => validateFiles({ 'huge.txt': 'a'.repeat(200001) }), /File too large/);
  assert.equal(languageFor('src/App.jsx'), 'javascript');
  assert.equal(languageFor('src/a.css'), 'css');
});
