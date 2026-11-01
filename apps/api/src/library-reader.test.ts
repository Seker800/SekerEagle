import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { startLibraryReader } from './library-reader';

test('reader startup rejects unsafe targets before opening a listener', async () => {
  await assert.rejects(
    startLibraryReader({
      DATABASE_URL: 'postgresql://test@127.0.0.1/unknown',
      EAGLE_READER_TOKEN: 'test',
    }),
    /数据库名/,
  );
});
test('a listen failure releases signal handlers and its unused pool', async () => {
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  const before = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  try {
    await assert.rejects(
      startLibraryReader({
        DATABASE_URL: 'postgresql://test@127.0.0.1:1/sekereagle_test',
        EAGLE_READER_TOKEN: 'test',
        EAGLE_READER_PORT: String(address.port),
      }),
      /EADDRINUSE/,
    );
    assert.deepEqual(
      ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal)),
      before,
    );
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
