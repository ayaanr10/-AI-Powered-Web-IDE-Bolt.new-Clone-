import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/index.js';
import { MemoryUsageStore } from '../server/usage-store.js';
import { seedProject } from '../shared/seed-project.js';

const productionEnv = () => ({
  NODE_ENV: 'production',
  GEMINI_API_KEY: 'server-only-test-gemini-key',
  GEMINI_MODEL: 'gemini-test',
  REDIS_URL: 'redis://test-store.invalid',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough-1234567890',
  TURNSTILE_SITE_KEY: 'public-test-site-key',
  TURNSTILE_SECRET_KEY: 'server-only-test-turnstile-key',
});

const validTurnstile = async () => ({ success: true, action: 'build', hostname: '127.0.0.1' });
async function* sampleGemini() {
  yield '<artifact><message>Added the app.</message><file path="src/App.jsx">export default function App(){return <h1>Hi</h1>}</file></artifact>';
}

function createTestApp({ env = productionEnv(), store = new MemoryUsageStore(), verifier = validTurnstile, gemini = sampleGemini, limits } = {}) {
  return createApp({ env, usageStore: store, turnstileVerifier: verifier, geminiStreamer: gemini, limits });
}

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { return await callback('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function buildRequest(base, { token = 'valid-turnstile-token', files = seedProject, prompt = 'Build a restaurant', cookie, extraHeaders = {} } = {}) {
  return fetch(base + '/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: base,
      'sec-fetch-site': 'same-origin',
      'cf-connecting-ip': '198.51.100.10',
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({ prompt, files, ...(token ? { turnstileToken: token } : {}) }),
  });
}

function cookiePair(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0];
}

test('health does not disclose secrets and reports production setup state', async () => {
  const app = createTestApp();
  await withServer(app, async (base) => {
    const response = await fetch(base + '/api/health');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.zapAvailable, true);
    assert.equal(body.requiresBotVerification, true);
    assert.equal(body.turnstileSiteKey, 'public-test-site-key');
    assert.equal('zapProtected' in body, false);
    assert.equal(JSON.stringify(body).includes('server-only-test-gemini-key'), false);
    assert.equal(JSON.stringify(body).includes('server-only-test-turnstile-key'), false);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /Secure/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  });
});

test('production fails closed when a durable store or public safety settings are missing', async () => {
  const env = { ...productionEnv(), REDIS_URL: '', TURNSTILE_SECRET_KEY: '', SESSION_SECRET: '' };
  const app = createApp({ env, geminiStreamer: async function* () { throw new Error('must not run'); } });
  await withServer(app, async (base) => {
    const health = await fetch(base + '/api/health').then((r) => r.json());
    assert.equal(health.zapAvailable, false);
    assert.match(health.zapMessage, /safety checks/);
    const response = await buildRequest(base);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /safety checks/);
  });
});

test('malformed prompts and obsolete generation modes are rejected before Gemini', async () => {
  const app = createTestApp({ gemini: async function* () { throw new Error('must not run'); } });
  await withServer(app, async (base) => {
    const invalid = await buildRequest(base, { prompt: '' });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /1–2000 characters/);

    const obsolete = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ prompt: 'Build a restaurant', files: seedProject, mode: 'demo' }),
    });
    assert.equal(obsolete.status, 400);
    assert.match((await obsolete.json()).error, /no longer available/);
  });
});

test('Build now works without an owner access code after server verification', async () => {
  let calls = 0;
  const app = createTestApp({ verifier: async ({ token, secretKey, remoteIp }) => {
    calls += 1;
    assert.equal(token, 'valid-turnstile-token');
    assert.equal(secretKey, 'server-only-test-turnstile-key');
    assert.equal(remoteIp, '198.51.100.10');
    return { success: true, action: 'build', hostname: '127.0.0.1' };
  } });
  await withServer(app, async (base) => {
    const response = await buildRequest(base);
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events[0].type, 'start');
    assert.equal(events.some((event) => event.type === 'chunk' && event.text.includes('export default function App')), true);
    assert.equal(events.at(-1).type, 'done');
    assert.match(cookiePair(response), /^__Host-buildora_sid=/);
  });
});

test('production rejects missing, expired, or wrong-host bot verification before Gemini', async () => {
  let generated = false;
  const app = createTestApp({
    verifier: async ({ token }) => token === 'wrong-host'
      ? { success: true, action: 'build', hostname: 'attacker.example' }
      : { success: false },
    gemini: async function* () { generated = true; yield 'unexpected'; },
  });
  await withServer(app, async (base) => {
    const missing = await buildRequest(base, { token: '' });
    assert.equal(missing.status, 403);
    assert.match((await missing.json()).error, /quick security check/);
    const rejected = await buildRequest(base, { token: 'expired-token' });
    assert.equal(rejected.status, 403);
    const wrongHost = await buildRequest(base, { token: 'wrong-host' });
    assert.equal(wrongHost.status, 403);
    assert.equal(generated, false);
  });
});

test('server rejects cross-origin browser requests', async () => {
  const app = createTestApp();
  await withServer(app, async (base) => {
    const response = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ prompt: 'Build a page', files: seedProject, turnstileToken: 'valid-turnstile-token' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /directly|Buildora/);
  });
});

test('production fails closed when the trusted client IP header is missing', async () => {
  let generated = false;
  const app = createTestApp({ gemini: async function* () { generated = true; yield 'unexpected'; } });
  await withServer(app, async (base) => {
    const response = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ prompt: 'Build a page', files: seedProject, turnstileToken: 'valid-turnstile-token' }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /verify this network/);
    assert.equal(generated, false);
  });
});

test('per-IP limits return HTTP 429 with a clear retry message', async () => {
  const limits = {
    verificationPerIpWindow: 12,
    generationsPerIpWindow: 1,
    generationsPerIpDay: 10,
    generationsPerBrowserDay: 5,
    generationsPerAppWindow: 8,
    generationsPerAppDay: 25,
  };
  const app = createTestApp({ limits });
  await withServer(app, async (base) => {
    const first = await buildRequest(base);
    assert.equal(first.status, 200);
    const cookie = cookiePair(first);
    await first.arrayBuffer();
    const second = await buildRequest(base, { cookie, extraHeaders: { 'x-forwarded-for': '203.0.113.8' } });
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /network/);
    assert.ok(Number(second.headers.get('retry-after')) > 0);
  });
});

test('per-browser daily quotas survive cookie reuse and explain the limit', async () => {
  const limits = {
    verificationPerIpWindow: 12,
    generationsPerIpWindow: 10,
    generationsPerIpDay: 10,
    generationsPerBrowserDay: 1,
    generationsPerAppWindow: 8,
    generationsPerAppDay: 25,
  };
  const app = createTestApp({ limits });
  await withServer(app, async (base) => {
    const first = await buildRequest(base);
    assert.equal(first.status, 200);
    const cookie = cookiePair(first);
    await first.arrayBuffer();
    const second = await buildRequest(base, { cookie });
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /this browser/);
  });
});

test('shared daily quota stops requests even when a visitor changes IP and browser', async () => {
  const limits = {
    verificationPerIpWindow: 12,
    generationsPerIpWindow: 10,
    generationsPerIpDay: 10,
    generationsPerBrowserDay: 5,
    generationsPerAppWindow: 8,
    generationsPerAppDay: 1,
  };
  const app = createTestApp({ limits });
  await withServer(app, async (base) => {
    const first = await buildRequest(base, { extraHeaders: { 'cf-connecting-ip': '198.51.100.10' } });
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    const second = await buildRequest(base, { extraHeaders: { 'cf-connecting-ip': '203.0.113.80' } });
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /shared build limit/);
  });
});

test('Gemini outages become useful but non-sensitive stream errors', async () => {
  const app = createTestApp({ gemini: async function* () { throw new Error('Gemini API 503: private provider detail'); } });
  await withServer(app, async (base) => {
    const response = await buildRequest(base);
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    const error = events.find((event) => event.type === 'error');
    assert.match(error.message, /Gemini is temporarily unavailable/);
    assert.equal(error.message.includes('private provider detail'), false);
  });
});

test('quota-store outages fail closed without calling Gemini', async () => {
  let generated = false;
  const brokenStore = { isReady: () => true, consume: async () => { throw new Error('offline'); }, acquireLock: async () => true, releaseLock: async () => {} };
  const app = createTestApp({ store: brokenStore, gemini: async function* () { generated = true; yield 'unexpected'; } });
  await withServer(app, async (base) => {
    const response = await buildRequest(base);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /security checks/);
    assert.equal(generated, false);
  });
});

test('local generation keeps working without a hosted bot-check configuration', async () => {
  const app = createTestApp({
    env: { NODE_ENV: 'development', GEMINI_API_KEY: 'local-test-key' },
    verifier: async () => { throw new Error('local mode should skip Turnstile'); },
  });
  await withServer(app, async (base) => {
    const response = await buildRequest(base, { token: '' });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'done');
  });
});

test('client request code contains no access-code header or Gemini key', async () => {
  const apiClient = await readFile(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  const clientApp = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.equal(apiClient.includes('x-zap-access-code'), false);
  assert.equal(clientApp.includes('Private Zap access code'), false);
  assert.equal(clientApp.includes('Code entered'), false);
  assert.equal(clientApp.includes('Locked'), false);
  assert.equal(clientApp.includes('GEMINI_API_KEY'), false);
});
