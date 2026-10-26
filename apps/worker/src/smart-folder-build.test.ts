import assert from 'node:assert/strict';
import test from 'node:test';
import { runSmartFolderBuildStep, smartFolderRetry, validateQueryVector } from './smart-folder-build';

test('smart-folder vectors require the fixed normalized finite 1024-dimensional space', () => {
  assert.doesNotThrow(() => validateQueryVector([1, ...Array(1023).fill(0)]));
  for (const vector of [
    [],
    [1, 0],
    Array(1024).fill(0),
    Array(1024).fill(NaN),
    Array(1024).fill(1),
  ])
    assert.throws(() => validateQueryVector(vector));
});

test('failed inference backs off and eventually requires an explicit retry', () => {
  const now = new Date('2026-10-23T00:00:00Z');
  assert.equal(smartFolderRetry(1, now).status, 'PENDING');
  assert.ok(smartFolderRetry(2, now).availableAt > smartFolderRetry(1, now).availableAt);
  assert.equal(smartFolderRetry(5, now).status, 'FAILED');
});


test('temporary model backpressure preserves the folder failure budget and releases its lease', async () => {
  const { EmbeddingClientError } = await import('./embedding-client');
  for (const code of ['HOST_BUSY', 'UPLOAD_TIMEOUT', 'HOST_UNAVAILABLE'] as const) {
    let saved: Record<string, unknown> | undefined;
    const client = {
      $queryRaw: async () => [{ id: 'snapshot', attempts: 4, hasVector: false, text: 'synthetic' }],
      eagleSmartFolderSemanticSnapshot: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { saved = data; return { count: 1 }; } },
    };
    const before = Date.now();
    await runSmartFolderBuildStep(client as never, 'space', async () => {
      throw new EmbeddingClientError(code, 'temporary', { retryAfterMs: 1000 });
    });
    assert(saved);
    assert.equal(saved.status, 'PENDING');
    assert.equal(saved.attempts, 4);
    assert.equal(saved.lockedUntil, null);
    assert.equal(saved.leaseToken, null);
    assert.ok((saved.availableAt as Date).getTime() >= before + 1000);
    if (code === 'HOST_BUSY') assert.equal(saved.errorCode, 'WAITING_EMBEDDING_CAPACITY');
  }
});
