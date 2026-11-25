import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserId, hashRateLimitIdentity, isSameOriginRequest, VerificationUnavailableError, verifyTurnstile } from '../server/security.js';
import { MemoryUsageStore } from '../server/usage-store.js';

test('anonymous browser ID is signed in a secure, HttpOnly cookie and reused when valid', () => {
  const secret = 'a sufficiently long session secret for this test';
  const headers = [];
  const response = { append: (name, value) => headers.push([name, value]) };
  const firstId = getBrowserId({ get: () => undefined }, response, { secret, secure: true });
  assert.equal(headers.length, 1);
  assert.match(headers[0][1], /^__Host-buildora_sid=/);
  assert.match(headers[0][1], /HttpOnly/);
  assert.match(headers[0][1], /Secure/);
  assert.match(headers[0][1], /SameSite=Strict/);

  const cookie = headers[0][1].split(';')[0];
  const reusedHeaders = [];
  const secondId = getBrowserId({ get: (name) => name === 'cookie' ? cookie : undefined }, { append: (...args) => reusedHeaders.push(args) }, { secret, secure: true });
  assert.equal(secondId, firstId);
  assert.equal(reusedHeaders.length, 0);
});

test('tampered browser cookie gets a new signed identity', () => {
  const headers = [];
  const cookie = '__Host-buildora_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.invalid';
  const id = getBrowserId({ get: (name) => name === 'cookie' ? cookie : undefined }, { append: (_name, value) => headers.push(value) }, { secret: 'another sufficiently long secret value', secure: true });
  assert.notEqual(id, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(headers.length, 1);
});

test('quota identities are one-way hashes', () => {
  const hash = hashRateLimitIdentity('203.0.113.8', 'hash-secret');
  assert.notEqual(hash, '203.0.113.8');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashRateLimitIdentity('203.0.113.8', 'hash-secret'), hash);
  assert.notEqual(hashRateLimitIdentity('203.0.113.8', 'rotated-secret'), hash);
});

test('same-origin check rejects cross-site requests', () => {
  const request = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
  assert.equal(isSameOriginRequest(request({ origin: 'https://buildora.example', host: 'buildora.example', 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(isSameOriginRequest(request({ origin: 'https://attacker.example', host: 'buildora.example', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(isSameOriginRequest(request({ origin: 'not a URL', host: 'buildora.example' })), false);
});

test('Turnstile token is validated server-side with a bounded request and secret', async () => {
  let request;
  const body = await verifyTurnstile({
    token: 'one-time-token', secretKey: 'server-secret', remoteIp: '203.0.113.8',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ success: true, action: 'build', hostname: 'buildora.example' }), { status: 200 });
    },
  });
  assert.equal(body.success, true);
  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.signal.aborted, false);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.secret, 'server-secret');
  assert.equal(payload.response, 'one-time-token');
  assert.equal(payload.remoteip, '203.0.113.8');
  assert.match(payload.idempotency_key, /^[0-9a-f-]{36}$/i);
});

test('Turnstile network failures fail closed with a safe error type', async () => {
  await assert.rejects(
    verifyTurnstile({ token: 'token', secretKey: 'secret', fetchImpl: async () => { throw new Error('secret endpoint detail'); } }),
    (error) => error instanceof VerificationUnavailableError && !error.message.includes('secret endpoint detail'),
  );
});

test('memory quotas check a batch atomically and reset after their TTL', async () => {
  let now = 0;
  const store = new MemoryUsageStore({ clock: () => now });
  const first = await store.consume([{ key: 'browser:day', name: 'browserDay', limit: 1, ttlSeconds: 10 }]);
  assert.equal(first.allowed, true);

  const blockedBatch = await store.consume([
    { key: 'browser:day', name: 'browserDay', limit: 1, ttlSeconds: 10 },
    { key: 'app:day', name: 'appDay', limit: 2, ttlSeconds: 10 },
  ]);
  assert.deepEqual(blockedBatch, { allowed: false, name: 'browserDay', retryAfterSeconds: 10 });
  assert.equal((await store.consume([{ key: 'app:day', name: 'appDay', limit: 2, ttlSeconds: 10 }])).allowed, true);

  now = 11_000;
  assert.equal((await store.consume([{ key: 'browser:day', name: 'browserDay', limit: 1, ttlSeconds: 10 }])).allowed, true);
});

test('generation locks allow only one active request and are released by their owner', async () => {
  const store = new MemoryUsageStore();
  assert.equal(await store.acquireLock('browser:lock', 'token-a', 30), true);
  assert.equal(await store.acquireLock('browser:lock', 'token-b', 30), false);
  await store.releaseLock('browser:lock', 'token-b');
  assert.equal(await store.acquireLock('browser:lock', 'token-c', 30), false);
  await store.releaseLock('browser:lock', 'token-a');
  assert.equal(await store.acquireLock('browser:lock', 'token-c', 30), true);
});
