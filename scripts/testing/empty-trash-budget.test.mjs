import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
after(() => db.$disconnect());
async function fixture(mode) {
  const ownerId = randomUUID(),
    id = randomUUID();
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  await db.eagleAsset.create({
    data: {
      id,
      ownerId,
      libraryMode: mode,
      originalName: 'test.jpg',
      displayName: 'test',
      normalizedDisplayName: 'test',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      originalObjectKey: `users/${ownerId}/${id}`,
      deletedAt: new Date(Date.now() - 10000),
    },
  });
  const locker = new Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  await locker.query('BEGIN');
  await locker.query('SELECT id FROM "EagleAsset" WHERE id=$1 FOR UPDATE', [id]);
  const service = new EagleService(db, undefined, mode);
  return {
    ownerId,
    id,
    locker,
    service,
    async close() {
      await locker.query('ROLLBACK');
      await locker.end();
      await db.eagleAssetOperation.deleteMany({ where: { ownerId } });
      await db.eagleAsset.deleteMany({ where: { ownerId } });
      await db.user.delete({ where: { id: ownerId } });
    },
  };
}
for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode} direct clear survives a real lock wait beyond five seconds and commits once`, async () => {
    const f = await fixture(mode);
    const release = delay(6500).then(() => f.locker.query('COMMIT'));
    try {
      assert.deepEqual(await f.service.emptyTrash(f.ownerId), { affectedAssetCount: 1 });
      await release;
      assert.ok((await db.eagleAsset.findUniqueOrThrow({ where: { id: f.id } })).purgeAfter);
      assert.equal(
        await db.eagleAssetProcessingJob.count({
          where: { ownerId: f.ownerId, kind: 'PURGE_ASSET' },
        }),
        1,
      );
      assert.deepEqual(await f.service.emptyTrash(f.ownerId), { affectedAssetCount: 0 });
    } finally {
      await release;
      await f.close();
    }
  });
  test(`${mode} bounded clear fully rolls back and the same queued command can be retried`, async () => {
    const f = await fixture(mode),
      previous = process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS;
    const principal = {
      sub: f.ownerId,
      authVersion: 0,
      canViewPrivate: false,
      privacyVisibleUntil: null,
    };
    const operations = new EagleAssetOperationService(db, {}, f.service, mode);
    // Test-only release prevents a broken DB cancellation policy hanging this regression.
    const release = delay(3000).then(() => f.locker.query('COMMIT'));
    try {
      process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS = '1000';
      const command = await operations.enqueue(principal, {
        operationId: randomUUID(),
        kind: 'EMPTY_TRASH',
        assetIds: [],
      });
      await operations.tick();
      const failed = (await operations.list(f.ownerId))[0];
      assert.equal(failed.id, command.id);
      assert.equal(failed.failed, 1);
      assert.deepEqual(failed.errors, [{ code: 'TRANSACTION_TIMEOUT', count: 1 }]);
      assert.equal(
        (await db.eagleAsset.findUniqueOrThrow({ where: { id: f.id } })).purgeAfter,
        null,
      );
      assert.equal(
        await db.eagleAssetProcessingJob.count({
          where: { ownerId: f.ownerId, kind: 'PURGE_ASSET' },
        }),
        0,
      );
      assert.equal(await db.eagleMediaJobEvent.count({ where: { ownerId: f.ownerId } }), 0);
      await f.locker.query('COMMIT');
      await operations.retry(principal, command.id);
      await operations.tick();
      assert.equal((await operations.list(f.ownerId))[0].completed, 1);
      assert.equal(
        await db.eagleAssetProcessingJob.count({
          where: { ownerId: f.ownerId, kind: 'PURGE_ASSET' },
        }),
        1,
      );
      assert.equal(await db.eagleMediaJobEvent.count({ where: { ownerId: f.ownerId } }), 1);
    } finally {
      if (previous === undefined) delete process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS;
      else process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS = previous;
      await release;
      await f.close();
    }
  });
}
