import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server/index.js';
import { seedProject } from '../shared/seed-project.js';

// These tests use the local Express app; no actual Gemini calls or API key required.
async function withServer(callback) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback('http://127.0.0.1:' + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('health exposes Zap readiness without exposing a secret', async () => {
  await withServer(async (base) => {
    const response = await fetch(base + '/api/health');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.zapAvailable, 'boolean');
    assert.equal(typeof body.zapMessage, 'string');
    assert.equal('liveAvailable' in body, false);
    assert.equal(JSON.stringify(body).includes(process.env.GEMINI_API_KEY || 'VERY_PRIVATE_KEY_SHOULD_NOT_APPEAR'), false);
  });
});

test('obsolete Demo requests are explicitly rejected', async () => {
  await withServer(async (base) => {
    const response = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Build a restaurant', files: seedProject, mode: 'demo' }),
    });
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.match(result.error, /Demo mode has been removed/);
  });
});

test('Zap still validates input before generating', async () => {
  await withServer(async (base) => {
    const response = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', files: seedProject }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /Prompt must have/);
  });
});
