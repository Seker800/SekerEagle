import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbeddingClientError } from './embedding-client';
import { embeddingRetry } from './embedding-retry';

test('busy capacity and interrupted uploads preserve attempts and do not close the vector channel', () => {
  const now = new Date('2026-10-26T01:00:00Z');
  for (const code of ['HOST_BUSY', 'UPLOAD_TIMEOUT'] as const) {
    const error = Object.assign(new EmbeddingClientError(code, 'temporary'), {
      retryAfterMs: 1000,
    });
    const retry = embeddingRetry(error, 1, now);
    assert(retry);
    assert.equal('offline' in retry, false);
    assert.equal(retry.data.status, 'PENDING');
    assert.equal(retry.data.attempts, 0);
    assert.equal(retry.data.lockedAt, null);
    assert.equal(retry.data.availableAt.getTime() - now.getTime(), 1000);
  }
});
test('a single unreachable request only defers itself without declaring the host offline', () => {
  const now = new Date('2026-10-26T01:00:00Z');
  const retry = embeddingRetry(new EmbeddingClientError('HOST_UNAVAILABLE', 'offline'), 0, now);
  assert(retry);
  assert.equal('offline' in retry, false);
  assert.equal(retry.data.attempts, 0);
  assert.equal(retry.data.availableAt.getTime() - now.getTime(), 30000);
  assert.equal(embeddingRetry(new Error('bad media'), 1, now), null);
  assert.equal(embeddingRetry(new EmbeddingClientError('MODEL_DRIFT', 'drift'), 1, now), null);
});
