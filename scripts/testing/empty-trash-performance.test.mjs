import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as flushQueries } from 'node:timers/promises';
import { after, test } from 'node:test';
import console from 'node:console';
import { PrismaClient, Prisma } from '@prisma/client';
import { Client } from 'pg';
import { setTimeout, clearTimeout } from 'node:timers';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let events = [];
db.$on('query', (event) => events.push(event));
after(() => db.$disconnect());

test('media job transition batches amortize triggers and preserve scoped evidence, rollback and wakeups', async () => {
  const ownerId = randomUUID();
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('schema');
  const listener = new Client({ connectionString: url.toString() });
  const notifications = [];
  listener.on('notification', (event) => { if (event.channel === 'sekereagle_worker_wakeup') notifications.push(event.payload); });
  const barrier = async () => {
    const token = randomUUID();
    const done = new Promise((resolve, reject) => {
      const callback = (event) => {
        if (event.channel !== 'sekereagle_test_media_barrier' || event.payload !== token) return;
        clearTimeout(timer); listener.off('notification', callback); resolve();
      };
      const timer = setTimeout(() => { listener.off('notification', callback); reject(new Error('Notification barrier timed out')); }, 5000);
      listener.on('notification', callback);
    });
    await db.$executeRaw`SELECT pg_notify('sekereagle_test_media_barrier', ${token})`;
    await done;
  };
  try {
    await listener.connect();
    await listener.query('LISTEN sekereagle_worker_wakeup');
    await listener.query('LISTEN sekereagle_test_media_barrier');
    await db.user.create({ data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' } });
    for (const mode of ['MATERIAL', 'PHOTO']) {
      await db.eagleAsset.createMany({ data: Array.from({ length: 32 }, (_, index) => ({
        id: randomUUID(), ownerId, libraryMode: mode, originalName: 'trigger.jpg', displayName: String(index), normalizedDisplayName: String(index), mimeType: 'image/jpeg', format: 'jpeg', byteSize: 1, originalObjectKey: `users/${ownerId}/${mode}/${index}`,
      })) });
      const before = notifications.length;
      const explain = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
        INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","processorVersion",status,"leaseVersion",attempts,"recoveryCount","updatedAt")
        SELECT gen_random_uuid()::text,${ownerId},${mode}::"LibraryMode",id,'PURGE_ASSET'::"EagleMediaJobKind",'MAINTENANCE'::"EagleProcessingLane",0,'v1','PENDING'::"EagleMediaJobStatus",1,0,0,CURRENT_TIMESTAMP
        FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"=${mode}::"LibraryMode"`);
      const transitionCalls = explain[0]['QUERY PLAN'][0].Triggers.filter((trigger) => trigger['Trigger Name'].startsWith('eagle_media_transition')).reduce((sum, trigger) => sum + trigger.Calls, 0);
      assert.equal(transitionCalls, 1, 'one set event insert per job statement, rather than one SPI insert per row');
      await barrier();
      assert.equal(notifications.length - before, 1);
      assert.equal(notifications.at(-1), 'media-ready:NAS');
      const scope = { ownerId, libraryMode: mode };
      const jobs = await db.eagleAssetProcessingJob.findMany({ where: scope });
      const inserted = await db.eagleMediaJobEvent.findMany({ where: scope });
      assert.equal(inserted.length, 32);
      assert.ok(inserted.every((event) => event.fromStatus === null && event.toStatus === 'PENDING' && event.leaseVersion === 1 && event.attempts === 0 && event.recoveryCount === 0));
      const updated = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
        UPDATE "EagleMediaJob" SET status='PROCESSING',"leaseVersion"="leaseVersion"+1,attempts=1,"lockedAt"=CURRENT_TIMESTAMP
        WHERE "ownerId"=${ownerId} AND "libraryMode"=${mode}::"LibraryMode"`);
      assert.equal(updated[0]['QUERY PLAN'][0].Triggers.filter((trigger) => trigger['Trigger Name'].startsWith('eagle_media_transition')).reduce((sum, trigger) => sum + trigger.Calls, 0), 1);
      const transitions = await db.eagleMediaJobEvent.findMany({ where: { ...scope, fromStatus: 'PENDING' } });
      assert.equal(transitions.length, 32);
      assert.deepEqual(new Set(transitions.map((event) => event.jobId)), new Set(jobs.map((job) => job.id)));
      assert.ok(transitions.every((event) => event.toStatus === 'PROCESSING' && event.leaseVersion === 2 && event.attempts === 1 && event.recoveryCount === 0));
      await barrier();
      const unchangedWakeups = notifications.length;
      await db.eagleAssetProcessingJob.updateMany({ where: scope, data: { updatedAt: new Date() } });
      await barrier();
      assert.equal(notifications.length, unchangedWakeups, 'heartbeat-only writes do not wake workers');
      assert.equal(await db.eagleMediaJobEvent.count({ where: scope }), 64, 'heartbeat-only writes do not append events');
      await assert.rejects(db.$transaction(async (tx) => {
        await tx.eagleAssetProcessingJob.updateMany({ where: scope, data: { status: 'PENDING', leaseVersion: { increment: 1 }, recoveryCount: 1 } });
        throw new Error('ROLLBACK_TRANSITION_FIXTURE');
      }), /ROLLBACK_TRANSITION_FIXTURE/);
      await barrier();
      assert.equal(notifications.length, unchangedWakeups, 'rollback never leaks a notification');
      assert.equal(await db.eagleMediaJobEvent.count({ where: scope }), 64, 'rollback never leaks an event');
      assert.equal(await db.eagleAssetProcessingJob.count({ where: { ...scope, status: 'PROCESSING', leaseVersion: 2 } }), 32);
      await db.eagleAssetProcessingJob.updateMany({ where: scope, data: { status: 'PENDING', leaseVersion: { increment: 1 }, recoveryCount: 1 } });
      const recovered = await db.eagleMediaJobEvent.findMany({ where: { ...scope, fromStatus: 'PROCESSING' } });
      assert.equal(recovered.length, 32);
      assert.ok(recovered.every((event) => event.toStatus === 'PENDING' && event.leaseVersion === 3 && event.attempts === 1 && event.recoveryCount === 1));
      await barrier();
      const afterRecovery = notifications.length;
      await db.eagleAssetProcessingJob.updateMany({ where: scope, data: { status: 'PENDING' } });
      await barrier();
      assert.equal(notifications.length, afterRecovery + 1, 'explicit status updates retain the existing wakeup contract even when unchanged');
      assert.equal(await db.eagleMediaJobEvent.count({ where: scope }), 96, 'same status and lease append no redundant event');
      await db.$executeRaw`INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","updatedAt")
        SELECT gen_random_uuid()::text,${ownerId},${mode}::"LibraryMode",id,'PURGE_ASSET'::"EagleMediaJobKind",'MAINTENANCE'::"EagleProcessingLane",0,CURRENT_TIMESTAMP
        FROM "EagleAsset" WHERE FALSE`;

      await barrier();
      assert.equal(notifications.length, afterRecovery + 1, 'empty inserts do not wake workers');
      const mixedStart = notifications.length;
      await db.eagleAssetProcessingJob.createMany({ data: ['GENERATE_EMBEDDING', 'GENERATE_THUMBNAIL'].map((kind) => ({
        id: randomUUID(), ownerId, libraryMode: mode, assetId: jobs[0].assetId, kind, lane: 'BACKGROUND', assetRevision: 0,
      })) });
      await barrier();
      assert.deepEqual(notifications.slice(mixedStart).sort(), ['media-ready:EMBEDDING', 'media-ready:NAS'], 'mixed inserts wake each resource once without a generic broadcast');

    }
  } finally {
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await listener.end();
  }
});

for (const [mode, size] of [
  ['MATERIAL', 2048],
  ['PHOTO', 60000],
]) {
  test(`${mode}: empty trash schedules the entire selection with constant bindings and one atomic SQL`, async () => {
    const ownerId = randomUUID();
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
    });
    const cutoff = new Date(Date.now() - 1000);
    try {
      for (let offset = 0; offset < size + 3; offset += 256) {
        await db.eagleAsset.createMany({
          data: Array.from({ length: Math.min(256, size + 3 - offset) }, (_, i) => {
            const position = offset + i;
            return {
              id: randomUUID(),
              ownerId,
              libraryMode: mode,
              originalName: 'test.jpg',
              displayName: String(position),
              normalizedDisplayName: String(position),
              mimeType: 'image/jpeg',
              format: 'jpeg',
              byteSize: 1,
              originalObjectKey: `users/${ownerId}/assets/${position}/original`,
              deletedAt:
                position === size
                  ? null
                  : position === size + 1
                    ? new Date(cutoff.getTime() + 1)
                    : new Date(cutoff.getTime() - 1),
              isPrivate: position === size + 2,
            };
          }),
        });
      }
      await flushQueries();
      events = [];
      const result = await new EagleService(db, undefined, mode).emptyTrash(ownerId, false, cutoff);
      await flushQueries();
      const captured = events;
      const maxBindings = Math.max(...captured.map((event) => JSON.parse(event.params).length));
      console.log(
        JSON.stringify({
          benchmark: 'empty-trash',
          mode,
          size,
          sql: captured.length,
          maxBindings,
          statementMs: captured.find((event) => event.query.includes('WITH marked AS'))?.duration,
        }),
      );
      assert.equal(result.affectedAssetCount, size);
      assert.ok(
        maxBindings <= 32,
        `empty-trash must not materialize a selection-sized bind list; observed ${maxBindings}`,
      );
      assert.ok(
        captured.length <= 3,
        `one set statement plus BEGIN/COMMIT, observed ${captured.length}`,
      );
      assert.equal(
        await db.eagleAssetProcessingJob.count({
          where: { ownerId, libraryMode: mode, kind: 'PURGE_ASSET' },
        }),
        size,
      );
      assert.equal(
        await db.eagleAsset.count({
          where: { ownerId, libraryMode: mode, purgeAfter: { not: null } },
        }),
        size,
      );
      assert.equal(
        (await new EagleService(db, undefined, mode).emptyTrash(ownerId, false, cutoff))
          .affectedAssetCount,
        0,
      );
    } finally {
      await db.eagleAsset.deleteMany({ where: { ownerId } });
      await db.user.delete({ where: { id: ownerId } });
    }
  });
}
