import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeObjectReadWithRetry,
  isRetryableObjectReadError,
} from './object-storage-read-retry';

test('object reads retry only transient storage failures', () => {
  assert.equal(
    isRetryableObjectReadError({ name: 'SlowDown', $metadata: { httpStatusCode: 503 } }),
    true,
  );
  assert.equal(
    isRetryableObjectReadError({ name: 'NotModified', $metadata: { httpStatusCode: 304 } }),
    false,
  );
  assert.equal(
    isRetryableObjectReadError({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }),
    false,
  );
});

test('object reads perform one bounded retry after a transient failure', async () => {
  const delays: number[] = [];
  let attempts = 0;
  const result = await executeObjectReadWithRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('transient');
        error.name = 'UnknownError';
        throw error;
      }
      return 'thumbnail';
    },
    {
      random: () => 0.5,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    },
  );
  assert.equal(result, 'thumbnail');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [100]);
});
