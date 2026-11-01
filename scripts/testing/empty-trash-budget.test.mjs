import console from 'node:console';
import { setImmediate as flushQueries } from 'node:timers/promises';
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
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let observed = [];
db.$on('query', (event) => observed.push(event));
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
      assert.deepEqual(await f.service.emptyTrashBatch(f.ownerId), { affectedAssetCount: 1 });
      await release;
      assert.ok((await db.eagleAsset.findUniqueOrThrow({ where: { id: f.id } })).purgeAfter);
      assert.equal(
        await db.eagleAssetProcessingJob.count({
          where: { ownerId: f.ownerId, kind: 'PURGE_ASSET' },
        }),
        1,
      );
      assert.deepEqual(await f.service.emptyTrashBatch(f.ownerId), { affectedAssetCount: 0 });
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

for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode} authorization revoked after the set write rolls back assets, jobs and events`, async () => {
    const f = await fixture(mode);
    await f.locker.query('COMMIT');
    let checks = 0;
    const revoked = new Error('synthetic lease/private grant expired');
    try {
      await assert.rejects(
        f.service.emptyTrashBatch(f.ownerId, false, new Date(), async () => {
          if (++checks === 2) throw revoked;
        }),
        (error) => error === revoked,
      );
      assert.equal(checks, 2);
      assert.equal(
        (await db.eagleAsset.findUniqueOrThrow({ where: { id: f.id } })).purgeAfter,
        null,
      );
      assert.equal(await db.eagleAssetProcessingJob.count({ where: { ownerId: f.ownerId } }), 0);
      assert.equal(await db.eagleMediaJobEvent.count({ where: { ownerId: f.ownerId } }), 0);
    } finally {
      await f.close();
    }
  });

for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode} a clear command checkpoints bounded batches and retry retains already committed work`, async () => {
    const f = await fixture(mode);
    await f.locker.query('COMMIT');
    const previous = process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS;
    let release;
    try {
      const base = await db.eagleAsset.findUniqueOrThrow({ where: { id: f.id } });
      await db.eagleAsset.createMany({
        data: Array.from({ length: 512 }, (_, n) => ({
          id: randomUUID(),
          ownerId: f.ownerId,
          libraryMode: mode,
          originalName: 'step.jpg',
          displayName: String(n),
          normalizedDisplayName: String(n),
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${f.ownerId}/${randomUUID()}`,
          deletedAt: base.deletedAt,
        })),
      });
      const principal = {
        sub: f.ownerId,
        authVersion: 0,
        canViewPrivate: false,
        privacyVisibleUntil: null,
      };
      const make = () => new EagleAssetOperationService(db, {}, f.service, mode);
      const command = await make().enqueue(principal, {
        operationId: randomUUID(),
        kind: 'EMPTY_TRASH',
        assetIds: [],
      });
      await make().tick();
      assert.equal(
        await db.eagleAsset.count({ where: { ownerId: f.ownerId, purgeAfter: { not: null } } }),
        512,
      );
      const progress = (await make().list(f.ownerId))[0];
      assert.equal(progress.completed, 0, 'one committed batch is not the complete cutoff command');
      assert.equal(progress.queued, 1);
      const remaining = await db.eagleAsset.findFirstOrThrow({
        where: { ownerId: f.ownerId, purgeAfter: null },
      });
      const later = await db.eagleAsset.create({
        data: {
          id: randomUUID(),
          ownerId: f.ownerId,
          libraryMode: mode,
          originalName: 'later.jpg',
          displayName: 'later',
          normalizedDisplayName: 'later',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${f.ownerId}/${randomUUID()}`,
          deletedAt: new Date(Date.now() + 1000),
        },
      });
      await f.locker.query('BEGIN');
      await f.locker.query('SELECT id FROM "EagleAsset" WHERE id=$1 FOR UPDATE', [remaining.id]);
      release = delay(3000).then(() => f.locker.query('COMMIT'));
      process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS = '1000';
      await make().tick();
      const failed = (await make().list(f.ownerId))[0];
      assert.equal(failed.failed, 1);
      assert.deepEqual(failed.errors, [{ code: 'TRANSACTION_TIMEOUT', count: 1 }]);
      assert.equal(await db.eagleAssetProcessingJob.count({ where: { ownerId: f.ownerId } }), 512);
      await release;
      await make().retry(principal, command.id);
      await make().tick();
      await make().tick();
      assert.equal((await make().list(f.ownerId))[0].completed, 1);
      assert.equal(await db.eagleAssetProcessingJob.count({ where: { ownerId: f.ownerId } }), 513);
      assert.equal(await db.eagleMediaJobEvent.count({ where: { ownerId: f.ownerId } }), 513);
      assert.equal(
        (await db.eagleAsset.findUniqueOrThrow({ where: { id: later.id } })).purgeAfter,
        null,
      );
    } finally {
      if (previous === undefined) delete process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS;
      else process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS = previous;
      await release;
      await f.close();
    }
  });

for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode} clear reports admission, all bounded execution steps and sampled progress separately`, async () => {
    const f = await fixture(mode);
    await f.locker.query('COMMIT');
    try {
      await db.eagleAsset.createMany({
        data: Array.from({ length: 512 }, (_, n) => ({
          id: randomUUID(),
          ownerId: f.ownerId,
          libraryMode: mode,
          originalName: 'cost.jpg',
          displayName: String(n),
          normalizedDisplayName: String(n),
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${f.ownerId}/${randomUUID()}`,
          deletedAt: new Date(Date.now() - 10000),
        })),
      });
      const principal = {
        sub: f.ownerId,
        authVersion: 0,
        canViewPrivate: false,
        privacyVisibleUntil: null,
      };
      const operations = new EagleAssetOperationService(db, {}, f.service, mode);
      const count = (events) => ({
        sql: events.length,
        transactions: events.filter((row) => row.query === 'BEGIN').length,
        s3: 0,
      });
      await flushQueries();
      observed = [];
      await operations.enqueue(principal, {
        operationId: randomUUID(),
        kind: 'EMPTY_TRASH',
        assetIds: [],
      });
      await flushQueries();
      const admission = count(observed);
      const execution = [],
        progress = [];
      for (let step = 0; step < 3; step++) {
        observed = [];
        await operations.tick();
        await flushQueries();
        execution.push(count(observed));
        observed = [];
        const status = (await operations.list(f.ownerId))[0];
        await flushQueries();
        progress.push(count(observed));
        assert.equal(status.completed, step === 2 ? 1 : 0);
        assert.equal(status.failed, 0);
      }
      assert.equal(await db.eagleAssetProcessingJob.count({ where: { ownerId: f.ownerId } }), 513);
      console.log(
        JSON.stringify({
          benchmark: 'empty-trash-command',
          mode,
          assets: 513,
          admission,
          execution,
          progress,
          totalSql:
            admission.sql +
            execution.reduce((n, v) => n + v.sql, 0) +
            progress.reduce((n, v) => n + v.sql, 0),
          httpAuthIncluded: false,
          frontendSampling: false,
        }),
      );
    } finally {
      await f.close();
    }
  });
