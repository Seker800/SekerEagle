import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  listener.on('notification', (event) => {
    if (event.channel === 'sekereagle_worker_wakeup') notifications.push(event.payload);
  });
  const barrier = async () => {
    const token = randomUUID();
    const done = new Promise((resolve, reject) => {
      const callback = (event) => {
        if (event.channel !== 'sekereagle_test_media_barrier' || event.payload !== token) return;
        clearTimeout(timer);
        listener.off('notification', callback);
        resolve();
      };
      const timer = setTimeout(() => {
        listener.off('notification', callback);
        reject(new Error('Notification barrier timed out'));
      }, 5000);
      listener.on('notification', callback);
    });
    await db.$executeRaw`SELECT pg_notify('sekereagle_test_media_barrier', ${token})`;
    await done;
  };
  try {
    await listener.connect();
    await listener.query('LISTEN sekereagle_worker_wakeup');
    await listener.query('LISTEN sekereagle_test_media_barrier');
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
    });
    for (const mode of ['MATERIAL', 'PHOTO']) {
      await db.eagleAsset.createMany({
        data: Array.from({ length: 32 }, (_, index) => ({
          id: randomUUID(),
          ownerId,
          libraryMode: mode,
          originalName: 'trigger.jpg',
          displayName: String(index),
          normalizedDisplayName: String(index),
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${ownerId}/${mode}/${index}`,
        })),
      });
      const before = notifications.length;
      const explain = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
        INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","processorVersion",status,"leaseVersion",attempts,"recoveryCount","updatedAt")
        SELECT gen_random_uuid()::text,${ownerId},${mode}::"LibraryMode",id,'PURGE_ASSET'::"EagleMediaJobKind",'MAINTENANCE'::"EagleProcessingLane",0,'v1','PENDING'::"EagleMediaJobStatus",1,0,0,CURRENT_TIMESTAMP
        FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"=${mode}::"LibraryMode"`);
      const transitionCalls = explain[0]['QUERY PLAN'][0].Triggers.filter((trigger) =>
        trigger['Trigger Name'].startsWith('eagle_media_transition'),
      ).reduce((sum, trigger) => sum + trigger.Calls, 0);
      assert.equal(
        transitionCalls,
        1,
        'one set event insert per job statement, rather than one SPI insert per row',
      );
      await barrier();
      assert.equal(notifications.length - before, 1);
      assert.equal(notifications.at(-1), 'media-ready:NAS');
      const scope = { ownerId, libraryMode: mode };
      const jobs = await db.eagleAssetProcessingJob.findMany({ where: scope });
      const inserted = await db.eagleMediaJobEvent.findMany({ where: scope });
      assert.equal(inserted.length, 32);
      assert.ok(
        inserted.every(
          (event) =>
            event.fromStatus === null &&
            event.toStatus === 'PENDING' &&
            event.leaseVersion === 1 &&
            event.attempts === 0 &&
            event.recoveryCount === 0,
        ),
      );
      const updated = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
        UPDATE "EagleMediaJob" SET status='PROCESSING',"leaseVersion"="leaseVersion"+1,attempts=1,"lockedAt"=CURRENT_TIMESTAMP
        WHERE "ownerId"=${ownerId} AND "libraryMode"=${mode}::"LibraryMode"`);
      assert.equal(
        updated[0]['QUERY PLAN'][0].Triggers.filter((trigger) =>
          trigger['Trigger Name'].startsWith('eagle_media_transition'),
        ).reduce((sum, trigger) => sum + trigger.Calls, 0),
        1,
      );
      const transitions = await db.eagleMediaJobEvent.findMany({
        where: { ...scope, fromStatus: 'PENDING' },
      });
      assert.equal(transitions.length, 32);
      assert.deepEqual(
        new Set(transitions.map((event) => event.jobId)),
        new Set(jobs.map((job) => job.id)),
      );
      assert.ok(
        transitions.every(
          (event) =>
            event.toStatus === 'PROCESSING' &&
            event.leaseVersion === 2 &&
            event.attempts === 1 &&
            event.recoveryCount === 0,
        ),
      );
      await barrier();
      assert.equal(
        notifications.length,
        before + 1,
        'claiming PENDING jobs does not broadcast runnable work',
      );
      const unchangedWakeups = notifications.length;
      await db.eagleAssetProcessingJob.updateMany({
        where: scope,
        data: { updatedAt: new Date() },
      });
      await barrier();
      assert.equal(
        notifications.length,
        unchangedWakeups,
        'heartbeat-only writes do not wake workers',
      );
      assert.equal(
        await db.eagleMediaJobEvent.count({ where: scope }),
        64,
        'heartbeat-only writes do not append events',
      );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.eagleAssetProcessingJob.updateMany({
            where: scope,
            data: { status: 'PENDING', leaseVersion: { increment: 1 }, recoveryCount: 1 },
          });
          throw new Error('ROLLBACK_TRANSITION_FIXTURE');
        }),
        /ROLLBACK_TRANSITION_FIXTURE/,
      );
      await barrier();
      assert.equal(notifications.length, unchangedWakeups, 'rollback never leaks a notification');
      assert.equal(
        await db.eagleMediaJobEvent.count({ where: scope }),
        64,
        'rollback never leaks an event',
      );
      assert.equal(
        await db.eagleAssetProcessingJob.count({
          where: { ...scope, status: 'PROCESSING', leaseVersion: 2 },
        }),
        32,
      );
      await db.eagleAssetProcessingJob.updateMany({
        where: scope,
        data: { status: 'PENDING', leaseVersion: { increment: 1 }, recoveryCount: 1 },
      });
      const recovered = await db.eagleMediaJobEvent.findMany({
        where: { ...scope, fromStatus: 'PROCESSING' },
      });
      assert.equal(recovered.length, 32);
      assert.ok(
        recovered.every(
          (event) =>
            event.toStatus === 'PENDING' &&
            event.leaseVersion === 3 &&
            event.attempts === 1 &&
            event.recoveryCount === 1,
        ),
      );
      await barrier();
      const afterRecovery = notifications.length;
      await db.eagleAssetProcessingJob.updateMany({ where: scope, data: { status: 'PENDING' } });
      await barrier();
      assert.equal(
        notifications.length,
        afterRecovery + 1,
        'explicit status updates retain the existing wakeup contract even when unchanged',
      );
      assert.equal(
        await db.eagleMediaJobEvent.count({ where: scope }),
        96,
        'same status and lease append no redundant event',
      );
      await db.$executeRaw`INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","updatedAt")
        SELECT gen_random_uuid()::text,${ownerId},${mode}::"LibraryMode",id,'PURGE_ASSET'::"EagleMediaJobKind",'MAINTENANCE'::"EagleProcessingLane",0,CURRENT_TIMESTAMP
        FROM "EagleAsset" WHERE FALSE`;

      await barrier();
      assert.equal(notifications.length, afterRecovery + 1, 'empty inserts do not wake workers');
      const mixedStart = notifications.length;
      await db.eagleAssetProcessingJob.createMany({
        data: ['GENERATE_EMBEDDING', 'GENERATE_THUMBNAIL'].map((kind) => ({
          id: randomUUID(),
          ownerId,
          libraryMode: mode,
          assetId: jobs[0].assetId,
          kind,
          lane: 'BACKGROUND',
          assetRevision: 0,
        })),
      });
      await barrier();
      assert.deepEqual(
        notifications.slice(mixedStart).sort(),
        ['media-ready:EMBEDDING', 'media-ready:NAS'],
        'mixed inserts wake each resource once without a generic broadcast',
      );
      // One upsert statement contains a newly inserted embedding, a requeued
      // pending purge, and a processing purge whose lease must remain untouched.
      const pending = await db.eagleAssetProcessingJob.findUniqueOrThrow({
        where: { id: jobs[0].id },
      });
      await db.eagleAssetProcessingJob.update({
        where: { id: jobs[1].id },
        data: { status: 'PROCESSING', leaseVersion: { increment: 1 }, lockedAt: new Date() },
      });
      const processing = await db.eagleAssetProcessingJob.findUniqueOrThrow({
        where: { id: jobs[1].id },
      });
      const [latest] = await db.eagleMediaJobEvent.findMany({
        where: scope,
        orderBy: { id: 'desc' },
        take: 1,
      });
      await barrier();
      const upsertWakeups = notifications.length;
      const newId = randomUUID();
      const input = [
        { id: randomUUID(), assetId: pending.assetId, kind: 'PURGE_ASSET', processor: 'v1' },
        { id: randomUUID(), assetId: processing.assetId, kind: 'PURGE_ASSET', processor: 'v1' },
        {
          id: newId,
          assetId: jobs[2].assetId,
          kind: 'GENERATE_EMBEDDING',
          processor: 'mixed-upsert-v1',
        },
      ];
      const published = await db.$queryRaw(Prisma.sql`
        INSERT INTO "EagleMediaJob" AS job
          (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","processorVersion",status,attempts,"recoveryCount","leaseVersion","availableAt","updatedAt")
        SELECT input.id,${ownerId},${mode}::"LibraryMode",input."assetId",input.kind,'MAINTENANCE'::"EagleProcessingLane",0,input."processorVersion",'PENDING'::"EagleMediaJobStatus",0,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(input.map((row) => Prisma.sql`(${row.id},${row.assetId},${row.kind}::"EagleMediaJobKind",${row.processor})`))}) AS input(id,"assetId",kind,"processorVersion")
        ON CONFLICT ("assetId",kind,"assetRevision","processorVersion") DO UPDATE
        SET status='PENDING',attempts=0,"recoveryCount"=0,"leaseVersion"=job."leaseVersion"+1,"availableAt"=EXCLUDED."availableAt","lockedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
        WHERE job."ownerId"=EXCLUDED."ownerId" AND job."libraryMode"=EXCLUDED."libraryMode" AND job.status IN ('PENDING','FAILED','COMPLETED')
        RETURNING id`);
      assert.deepEqual(new Set(published.map((row) => row.id)), new Set([pending.id, newId]));
      const upsertEvents = await db.eagleMediaJobEvent.findMany({
        where: { ...scope, id: { gt: latest.id } },
      });
      assert.equal(
        upsertEvents.length,
        2,
        'one INSERT and one real UPDATE append exactly two events; skipped conflicts append none',
      );
      assert.deepEqual(
        new Set(upsertEvents.map((event) => event.jobId)),
        new Set([pending.id, newId]),
      );
      for (const event of upsertEvents) {
        assert.equal(event.ownerId, ownerId);
        assert.equal(event.libraryMode, mode);
        assert.equal(event.fromStatus, event.jobId === newId ? null : 'PENDING');
        assert.equal(event.toStatus, 'PENDING');
        assert.equal(event.leaseVersion, event.jobId === newId ? 1 : pending.leaseVersion + 1);
        assert.equal(event.attempts, 0);
        assert.equal(event.recoveryCount, 0);
      }
      assert.deepEqual(
        await db.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: processing.id } }),
        processing,
        'a skipped processing conflict retains its full state and lease',
      );
      await barrier();
      assert.deepEqual(
        notifications.slice(upsertWakeups).sort(),
        ['media-ready:EMBEDDING', 'media-ready:NAS'],
        'mixed upsert notifications retain each affected resource once',
      );
    }
  } finally {
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await listener.end();
  }
});

test('empty trash requeues current and legacy purge identities once while preserving processing and scope guards', async () => {
  for (const mode of ['MATERIAL', 'PHOTO']) {
    const ownerId = randomUUID(),
      otherOwner = randomUUID();
    await db.user.createMany({
      data: [ownerId, otherOwner].map((id) => ({
        id,
        email: `${id}@example.invalid`,
        passwordHash: 'synthetic-only',
      })),
    });
    const cutoff = new Date(Date.now() - 1000);
    const asset = (patch = {}) =>
      db.eagleAsset.create({
        data: {
          id: randomUUID(),
          ownerId,
          libraryMode: mode,
          originalName: 'legacy.jpg',
          displayName: 'Legacy',
          normalizedDisplayName: 'legacy',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${ownerId}/${randomUUID()}`,
          deletedAt: new Date(cutoff.getTime() - 1),
          mediaRevision: 3,
          ...patch,
        },
      });
    const job = (source, patch = {}) =>
      db.eagleAssetProcessingJob.create({
        data: {
          id: randomUUID(),
          ownerId: source.ownerId,
          libraryMode: source.libraryMode,
          assetId: source.id,
          kind: 'PURGE_ASSET',
          lane: 'MAINTENANCE',
          assetRevision: source.mediaRevision,
          processorVersion: 'v1',
          status: 'FAILED',
          attempts: 12,
          recoveryCount: 3,
          leaseVersion: 7,
          lastError: 'synthetic-old-error',
          lockedAt: new Date(1),
          startedAt: new Date(1),
          completedAt: new Date(2),
          ...patch,
        },
      });
    try {
      const first = await asset(),
        second = await asset(),
        third = await asset();
      const current = await job(first);
      const legacyWithoutCurrent = await job(third, {
        assetRevision: 1,
        processorVersion: 'legacy-only',
      });
      const legacyRevision = await job(first, { assetRevision: 2, status: 'COMPLETED' });
      const legacyProcessor = await job(first, {
        processorVersion: 'legacy-purge',
        status: 'PENDING',
      });
      const currentProcessing = await job(second, { status: 'PROCESSING' });
      const legacyProcessing = await job(second, {
        assetRevision: 1,
        processorVersion: 'legacy-purge',
        status: 'PROCESSING',
      });
      const excluded = [
        currentProcessing,
        legacyProcessing,
        await job(await asset({ ownerId: otherOwner })),
        await job(await asset({ libraryMode: mode === 'MATERIAL' ? 'PHOTO' : 'MATERIAL' })),
        await job(await asset({ isPrivate: true })),
        await job(await asset({ deletedAt: null })),
        await job(await asset({ deletedAt: new Date(cutoff.getTime() + 1) })),
      ];
      const latest = await db.eagleMediaJobEvent.findFirstOrThrow({
        where: { ownerId },
        orderBy: { id: 'desc' },
      });
      const result = await new EagleService(db, undefined, mode).emptyTrash(ownerId, false, cutoff);
      assert.equal(result.affectedAssetCount, 3);
      for (const before of [current, legacyRevision, legacyProcessor, legacyWithoutCurrent]) {
        const actual = await db.eagleAssetProcessingJob.findUniqueOrThrow({
          where: { id: before.id },
        });
        assert.equal(actual.status, 'PENDING');
        assert.equal(actual.attempts, 0);
        assert.equal(actual.recoveryCount, 0);
        assert.equal(
          actual.leaseVersion,
          before.leaseVersion + 1,
          'current and legacy rows are requeued exactly once',
        );
        for (const field of ['lockedAt', 'startedAt', 'completedAt', 'lastError'])
          assert.equal(actual[field], null);
      }
      for (const before of excluded)
        assert.deepEqual(
          await db.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: before.id } }),
          before,
          'processing and out-of-scope rows retain every field',
        );
      const transitions = await db.eagleMediaJobEvent.findMany({
        where: { ownerId, id: { gt: latest.id } },
      });
      const created = await db.eagleAssetProcessingJob.findUniqueOrThrow({
        where: {
          assetId_kind_assetRevision_processorVersion: {
            assetId: third.id,
            kind: 'PURGE_ASSET',
            assetRevision: 3,
            processorVersion: 'v1',
          },
        },
      });
      assert.equal(
        created.leaseVersion,
        1,
        'newly created current identity is never updated a second time',
      );
      assert.equal(created.status, 'PENDING');
      assert.equal(created.attempts, 0);
      assert.equal(created.recoveryCount, 0);
      assert.equal(transitions.length, 5, 'current/new/legacy identities each append one event');
      const requeued = [current, legacyRevision, legacyProcessor, legacyWithoutCurrent];
      assert.deepEqual(
        new Set(transitions.map((event) => event.jobId)),
        new Set([...requeued.map((entry) => entry.id), created.id]),
      );
      for (const event of transitions) {
        const before = requeued.find((entry) => entry.id === event.jobId);
        assert.equal(event.fromStatus, before ? before.status : null);
        assert.equal(event.toStatus, 'PENDING');
        assert.equal(event.leaseVersion, before ? 8 : 1);
        assert.equal(event.attempts, 0);
        assert.equal(event.recoveryCount, 0);
      }
    } finally {
      await db.eagleAsset.deleteMany({ where: { ownerId: { in: [ownerId, otherOwner] } } });
      await db.user.deleteMany({ where: { id: { in: [ownerId, otherOwner] } } });
    }
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

test('one-row priming cannot leave a quadratic transition join for later fifty-thousand-job updates', async () => {
  const ownerId = randomUUID(),
    prefix = randomUUID(),
    size = 50000;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const evidence = { primingRows: 1, primingUpdates: 6, batchRows: size, phases: [], plans: [] };
  const plans = [];
  client.on('notice', (notice) => {
    const start = notice.message.indexOf('{');
    if (start < 0 || !notice.message.includes('EagleMediaJobEvent')) return;
    try {
      const plan = JSON.parse(notice.message.slice(start));
      if (plan['Query Text']?.includes('FROM new_jobs current_job JOIN old_jobs previous_job'))
        plans.push(plan);
    } catch {
      /* Non-plan server notices do not contain an event execution plan. */
    }
  });
  const run = async (label, status, oneRow = false, heartbeat = false) => {
    const start = plans.length;
    await client.query(
      `UPDATE "EagleMediaJob" SET ${heartbeat ? '"updatedAt"=CURRENT_TIMESTAMP' : `status=$2${oneRow ? ',"leaseVersion"="leaseVersion"+1' : ''}`} WHERE "ownerId"=$1${oneRow ? ' AND id=$3' : ''}`,
      heartbeat ? [ownerId] : oneRow ? [ownerId, status, `job-${prefix}-1`] : [ownerId, status],
    );
    const captured = plans.slice(start);
    assert.equal(captured.length, 1, 'auto_explain captures the actual event INSERT SELECT plan');
    const scans = [];
    const joins = [];
    const visit = (node) => {
      if (node['Node Type'] === 'Named Tuplestore Scan') scans.push(node);
      if (node['Join Type']) joins.push(node['Node Type']);
      for (const child of node.Plans ?? []) visit(child);
    };
    visit(captured[0].Plan);
    evidence.plans.push({ label, plan: captured[0] });
    evidence.phases.push({
      label,
      backendPid: client.processID,
      rows: oneRow ? 1 : size,
      joins,
      scans: scans.map((scan) => ({ rows: scan['Actual Rows'], loops: scan['Actual Loops'] })),
    });
    assert.equal(scans.length, 2);
    for (const scan of scans)
      assert.ok(
        scan['Actual Loops'] <= 2,
        'each transition relation is scanned a bounded number of times, not once per opposite row',
      );
  };
  try {
    await client.connect();
    evidence.backendPid = client.processID;
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
    });
    await db.$executeRaw`INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","mediaRevision","updatedAt")
      SELECT ${prefix}||'-'||n,${ownerId},'MATERIAL','synthetic.jpg','Synthetic','synthetic','image/jpeg','jpeg',1,'users/'||${ownerId}||'/'||${prefix}||'-'||n,1,CURRENT_TIMESTAMP FROM generate_series(1,${size}) n`;
    await db.$executeRaw`INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId","assetRevision",kind,lane,"processorVersion","updatedAt")
      SELECT 'job-'||id,"ownerId","libraryMode",id,1,'GENERATE_EMBEDDING','BACKGROUND','synthetic-cardinality-v1',CURRENT_TIMESTAMP FROM "EagleAsset" WHERE "ownerId"=${ownerId}`;
    await client.query("LOAD 'auto_explain'");
    await client.query("SET client_min_messages='log'");
    await client.query("SET auto_explain.log_format='json'");
    await client.query('SET auto_explain.log_analyze=on');
    await client.query('SET auto_explain.log_timing=off');
    await client.query('SET auto_explain.log_buffers=on');
    await client.query('SET auto_explain.log_nested_statements=on');
    await client.query('SET auto_explain.log_min_duration=0');
    for (let index = 0; index < 6; index++)
      await run(`prime-${index}`, index % 2 ? 'PENDING' : 'FAILED', true);
    // This test-only guard fails a cached 50k x 50k join promptly. It is not a
    // production transaction budget or a response-time promise for arbitrary NAS.
    await client.query("SET statement_timeout='10s'");
    // Suppress per-row FK diagnostic noise while retaining the actual bulk
    // INSERT SELECT plan. A real fifty-thousand-row event write exceeds 1ms.
    await client.query('SET auto_explain.log_min_duration=1');
    await run('large-failed', 'FAILED');
    await run('large-requeued', 'PENDING');
    const eventsBeforeHeartbeat = await db.eagleMediaJobEvent.count({ where: { ownerId } });
    await run('large-heartbeat', null, false, true);
    assert.equal(
      await db.eagleMediaJobEvent.count({ where: { ownerId } }),
      eventsBeforeHeartbeat,
      'fifty-thousand heartbeat rows append zero events',
    );
    const result = await db.eagleMediaJobEvent.groupBy({
      where: { ownerId },
      by: ['fromStatus', 'toStatus'],
      _count: true,
    });
    const count = (fromStatus, toStatus) =>
      result.find((row) => row.fromStatus === fromStatus && row.toStatus === toStatus)?._count ?? 0;
    assert.equal(count(null, 'PENDING'), size);
    assert.equal(count('PENDING', 'FAILED'), size + 3);
    assert.equal(count('FAILED', 'PENDING'), size + 3);
    assert.equal(
      await db.eagleAssetProcessingJob.count({ where: { ownerId, status: 'PENDING' } }),
      size,
    );
    assert.equal(
      (await db.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: `job-${prefix}-1` } }))
        .leaseVersion,
      6,
    );
    evidence.eventCounts = {
      inserted: count(null, 'PENDING'),
      failed: count('PENDING', 'FAILED'),
      requeued: count('FAILED', 'PENDING'),
    };
    evidence.status = 'PASSED';
  } catch (error) {
    evidence.status = 'FAILED';
    evidence.errorCode = error.code ?? null;
    throw error;
  } finally {
    await client.query('SET statement_timeout=0').catch(() => undefined);
    await client.end();
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    mkdirSync('.omx/artifacts', { recursive: true });
    writeFileSync(
      '.omx/artifacts/media-transition-cardinality.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
  }
});
