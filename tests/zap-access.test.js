import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesAccessCode } from '../server/zap-access.js';

test('accepts only the exact private Zap code', () => {
  const secret = 'long-secret-code-123456789';
  assert.equal(matchesAccessCode(secret, secret), true);
  assert.equal(matchesAccessCode('incorrect', secret), false);
  assert.equal(matchesAccessCode(secret + 'x', secret), false);
});
test('rejects missing code', () => {
  assert.equal(matchesAccessCode(undefined, 'valid-secret'), false);
  assert.equal(matchesAccessCode('', 'valid-secret'), false);
  assert.equal(matchesAccessCode('valid-secret', ''), false);
});
