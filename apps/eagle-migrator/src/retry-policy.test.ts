import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFailure, retryDelayMilliseconds } from './retry-policy';

test('only retries network, rate-limit, and server failures', () => {
  assert.equal(classifyFailure({ status: 429 }), 'RETRYABLE');
  assert.equal(classifyFailure({ status: 503 }), 'RETRYABLE');
  assert.equal(classifyFailure({ code: 'ECONNRESET' }), 'RETRYABLE');
  assert.equal(classifyFailure({ status: 400, code: 'CONTENT_HASH_MISMATCH' }), 'REJECTED');
  assert.equal(classifyFailure({ status: 401 }), 'REJECTED');
});

test('uses bounded exponential backoff and honors retry-after', () => {
  assert.equal(retryDelayMilliseconds(1, { random: () => 0 }), 1_000);
  assert.equal(retryDelayMilliseconds(8, { random: () => 0 }), 60_000);
  assert.equal(
    retryDelayMilliseconds(1, { random: () => 0, retryAfterMilliseconds: 12_000 }),
    12_000,
  );
});

