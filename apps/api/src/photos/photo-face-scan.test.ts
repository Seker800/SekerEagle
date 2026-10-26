import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('scan enqueues the whole visible photo library on the background lane without a 500-photo ceiling', async () => {
  const previous = [process.env.PHOTO_FACE_PYTHON, process.env.PHOTO_FACE_MODEL_DIR];
  process.env.PHOTO_FACE_PYTHON = 'python3';
  process.env.PHOTO_FACE_MODEL_DIR = '/models';
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push(query);
      return query.sql.includes('INSERT INTO') ? [{ queued: 1201n }] : [];
    },
    $executeRaw: async () => 0,
  };
  const db = {
    $queryRaw: async () =>
      Array.from({ length: 500 }, (_, i) => ({ id: `asset-${i}`, mediaRevision: 1 })),
    eagleAssetProcessingJob: {
      createMany: async () => ({ count: 500 }),
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  };
  try {
    const result = await new PhotoManagementService(db as never).scanFaces('owner', false);
    assert.equal(result.queued, 1201);
    const write = queries.find((query) => query.sql.includes('INSERT INTO'))!;
    assert.ok(write);
    assert.doesNotMatch(write.sql, /LIMIT 500|INTERACTIVE/);
    assert.match(write.sql, /BACKGROUND/);
    assert.match(write.sql, /ON CONFLICT.*DO NOTHING/s);
    assert.ok(write.values.includes('owner'));
    assert.ok(write.values.includes(false));
  } finally {
    for (const [i, key] of ['PHOTO_FACE_PYTHON', 'PHOTO_FACE_MODEL_DIR'].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  }
});
