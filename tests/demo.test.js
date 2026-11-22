import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoArtifact } from '../server/demo.js';
import { parseArtifact, StreamingArtifactParser } from '../shared/artifact-parser.js';
import { seedProject } from '../shared/seed-project.js';
import { applyAction, validateFiles } from '../shared/filesystem.js';

test('demo mode produces a fully parseable task manager', () => {
  const artifact = parseArtifact(getDemoArtifact('make a todo app'));
  assert.equal(artifact.title, 'FocusFlow Task Manager');
  assert.equal(artifact.actions.filter((action) => action.type === 'file').length, 2);
  let files = { ...seedProject };
  for (const action of artifact.actions) files = applyAction(files, action);
  assert.equal(validateFiles(files), files);
  assert.match(files['src/App.jsx'], /setTodos/);
});

test('demo mode landing page works with arbitrary streaming chunks', () => {
  const xml = getDemoArtifact('landing page for SaaS');
  const parser = new StreamingArtifactParser();
  let actions = [];
  for (let i = 0; i < xml.length; i += 13) actions.push(...parser.push(xml.slice(i, i + 13)));
  parser.finish();
  assert.equal(actions.length, 3);
  assert.match(actions[1].content, /Join the waitlist/);
});

test('demo mode creates a restaurant website instead of a generic landing page', () => {
  const artifact = parseArtifact(getDemoArtifact('Build a restaurant site with menu and reservations'));
  assert.equal(artifact.title, 'Savour Restaurant Website');
  let files = { ...seedProject };
  for (const action of artifact.actions) files = applyAction(files, action);
  assert.equal(validateFiles(files), files);
  assert.match(files['src/App.jsx'], /Savour|restaurant/);
  assert.match(files['src/App.jsx'], /submitReservation/);
  assert.match(files['src/styles.css'], /restaurant/);
});

test('demo mode does not pretend unsupported custom prompts were generated', () => {
  assert.throws(
    () => getDemoArtifact('Make a realistic trading chart application'),
    /Demo mode only supports three templates/
  );
});
