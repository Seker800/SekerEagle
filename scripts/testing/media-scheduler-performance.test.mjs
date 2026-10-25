/* global console, setTimeout */
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import {
  createScheduledMediaSelector,
  selectScheduledMediaCandidates,
  invalidateMediaCandidates,
} from '../../apps/worker/dist/scheduled-media-candidates.js';
import { PostgresWakeListener } from '../../apps/worker/dist/job-wakeup.js';
import { EagleTaskCenterService } from '../../apps/api/dist/eagle/eagle-task-center.service.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
after(() => db.$disconnect());
const input = { where: { lane: 'BACKGROUND', kind: { in: ['GENERATE_EMBEDDING'] } }, take: 50 };
test('scheduler estimates retain correlations between kind, lane, state and processor', async () => {
  const rows =
    await db.$queryRaw`SELECT stxkind::text AS kinds FROM pg_statistic_ext WHERE stxname='EagleMediaJob_scheduler_selectivity'`;
  assert.equal(
    rows.length,
    1,
    'independent selectivity estimates must not turn a large ready pool into random nested lookups',
  );
  assert.ok(rows[0].kinds.includes('m') && rows[0].kinds.includes('f'));
});

test('completed upload freshness has a covering lookup without weakening current-object ownership', async () => {
  const indexes =
    await db.$queryRaw`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='UploadSession' AND indexname='UploadSession_completed_freshness_cover_idx'`;
  assert.equal(
    indexes.length,
    1,
    'freshness lookups must avoid random reads of wide historical upload rows',
  );
  assert.match(
    indexes[0].indexdef,
    /\("objectKey"\) INCLUDE \("uploaderId", "libraryMode", "completedAt"\)/,
  );
  assert.match(indexes[0].indexdef, /WHERE \(status = 'COMPLETED'/);
  const assetIndexes =
    await db.$queryRaw`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='EagleAsset' AND indexname='EagleAsset_media_scheduler_cover_idx'`;
  assert.equal(assetIndexes.length, 1);
  for (const field of [
    'ownerId',
    'libraryMode',
    'mediaRevision',
    'deletedAt',
    'isPrivate',
    'originalObjectKey',
    'libraryAddedAt',
    'chronologicalAt',
  ])
    assert.ok(assetIndexes[0].indexdef.includes(`"${field}"`));
});

async function fixture(size = 1) {
  const owner = randomUUID(),
    prefix = randomUUID();
  await db.user.create({
    data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  await db.eagleProcessingSetting.create({
    data: { ownerId: owner, libraryMode: 'PHOTO', mode: 'ALWAYS' },
  });
  await db.$executeRaw`INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","mediaRevision","libraryAddedAt","chronologicalAt","updatedAt")
    SELECT ${prefix}||'-'||n,${owner},'PHOTO','synthetic.jpg','Synthetic','synthetic','image/jpeg','jpeg',1,'users/'||${owner}||'/assets/'||${prefix}||'-'||n||'/original.jpg',1,'2199-01-01'::timestamp+n*interval '1 second','2199-01-01'::timestamp,now() FROM generate_series(1,${size}) n`;
  // Fresh bulk fixtures need table statistics before per-row FK trigger plans are cached.
  if (size > 1000) await db.$executeRaw`ANALYZE "EagleAsset"`;
  await db.$executeRaw`INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId","assetRevision",kind,lane,"processorVersion","updatedAt") SELECT 'job-'||id,"ownerId","libraryMode",id,1,'GENERATE_EMBEDDING','BACKGROUND','synthetic-perf-v1',now() FROM "EagleAsset" WHERE "ownerId"=${owner}`;
  return { owner, prefix };
}
async function explain(options = {}) {
  let sql;
  await selectScheduledMediaCandidates(
    {
      $queryRaw: async (query) => {
        sql = query;
        return [];
      },
    },
    input,
    true,
    false,
    { resource: 'EMBEDDING', freshOnly: true, ...options },
  );
  const rows = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`);
  const plan = rows[0]['QUERY PLAN'][0];
  return {
    ms: plan['Execution Time'],
    sharedHits: plan.Plan['Shared Hit Blocks'],
    sharedReads: plan.Plan['Shared Read Blocks'],
  };
}
test('50k backlog discovery is amortized while every leased hint is revalidated against current policies and resource versions', async () => {
  const f = await fixture(50000);
  await db.$executeRaw`ANALYZE "EagleMediaJob"`;
  await db.$executeRaw`ANALYZE "EagleAsset"`;
  const baselinePlan = await explain();
  const sample = await selectScheduledMediaCandidates(db, input, true, false, {
    resource: 'EMBEDDING',
    freshOnly: true,
  });
  assert.equal(sample.length, 50);
  assert.ok(sample.every((row) => row.ownerId === f.owner));
  const restrictedPlan = await explain({ candidateIds: sample.map((row) => row.id) });
  const measure = async (select) => {
    const start = performance.now(),
      ids = new Set();
    for (let n = 0; n < 12; n++) {
      const rows = await select();
      assert.ok(rows.length && rows[0].ownerId === f.owner);
      assert.ok(!ids.has(rows[0].id), 'completed candidates cannot be reused');
      ids.add(rows[0].id);
      await db.eagleAssetProcessingJob.update({
        where: { id: rows[0].id },
        data: { status: 'COMPLETED' },
      });
    }
    return Math.round((performance.now() - start) * 10) / 10;
  };
  const uncachedMs = await measure(() =>
    selectScheduledMediaCandidates(db, input, true, false, {
      resource: 'EMBEDDING',
      freshOnly: true,
    }),
  );
  await db.eagleAssetProcessingJob.updateMany({
    where: { ownerId: f.owner },
    data: { status: 'PENDING' },
  });
  let discoveries = 0,
    validations = 0;
  const selector = createScheduledMediaSelector(
    {
      $queryRaw: (sql) => {
        if (sql.text.includes('job.id IN')) validations++;
        else discoveries++;
        return db.$queryRaw(sql);
      },
    },
    () => false,
    'EMBEDDING',
  );
  const cachedMs = await measure(() => selector(input, 'RECENT'));
  assert.equal(discoveries, 2, 'priority and FIFO cohorts each discover once');
  assert.equal(validations, 12);
  const measuredQueries = { discoveries, validations };
  const single = createScheduledMediaSelector(db, () => false, 'EMBEDDING');
  const one = { ...input, take: 1 };
  const firstWindow = await single(one, 'RECENT');
  await db.eagleAssetProcessingJob.update({
    where: { id: firstWindow[0].id },
    data: { status: 'COMPLETED' },
  });
  const nextWindow = await single(one, 'RECENT');
  assert.equal(
    nextWindow.length,
    1,
    'a consumed window must refill without waiting for the next external wake',
  );
  assert.notEqual(nextWindow[0].id, firstWindow[0].id);
  // A previously eligible cached asset becoming unavailable is filtered by the real DB query.
  const before = await selector(input, 'RECENT');
  await db.eagleAsset.update({ where: { id: before[0].assetId }, data: { deletedAt: new Date() } });
  const after = await selector(input, 'RECENT');
  assert.ok(!after.some((row) => row.assetId === before[0].assetId));
  await db.eagleProcessingSetting.update({
    where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } },
    data: { mode: 'MANUAL' },
  });
  const paused = await selector(input, 'RECENT');
  assert.ok(!paused.some((row) => row.ownerId === f.owner), 'cached IDs must not bypass pause');
  await db.eagleProcessingSetting.update({
    where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } },
    data: { mode: 'ALWAYS' },
  });
  await db.eagleTaskPolicy.create({
    data: { ownerId: f.owner, libraryMode: 'PHOTO', family: 'EMBEDDING', paused: true },
  });
  selector.invalidate();
  assert.ok(!(await selector(input, 'RECENT')).some((row) => row.ownerId === f.owner));
  await db.eagleAssetProcessingJob.updateMany({
    where: { ownerId: f.owner },
    data: { status: 'COMPLETED' },
  });
  await mkdir('.omx/artifacts', { recursive: true });
  await writeFile(
    '.omx/artifacts/scheduler-50k-results.json',
    JSON.stringify(
      {
        syntheticJobs: 50000,
        claims: 12,
        uncachedMs,
        cachedMs,
        ...measuredQueries,
        baselinePlan,
        restrictedPlan,
        note: 'Isolated local PostgreSQL; scheduling only, no images or inference. Two discovery cohorts preserve fairness; no production throughput claim.',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ syntheticJobs: 50000, uncachedMs, cachedMs, baselinePlan, restrictedPlan }),
  );
});

test('database notifications distinguish progress, newly eligible dependencies, policy changes and new work', async () => {
  const f = await fixture(3),
    payloads = [];
  const listener = new PostgresWakeListener(
    process.env.DATABASE_URL,
    (payload) => {
      if (payload) payloads.push(payload);
    },
    (error) => {
      throw error;
    },
  );
  const waitFor = async (value) => {
    for (let i = 0; i < 100 && !payloads.includes(value); i++)
      await new Promise((done) => setTimeout(done, 10));
    assert.ok(payloads.includes(value), `missing expected notification: ${value}`);
  };
  await listener.start();
  try {
    const [first, second, third] = await db.eagleAssetProcessingJob.findMany({
      where: { ownerId: f.owner },
      orderBy: { id: 'asc' },
    });
    await db.eagleAssetProcessingJob.update({
      where: { id: second.id },
      data: { dependsOnJobId: first.id },
    });
    await db.eagleAssetProcessingJob.update({
      where: { id: third.id },
      data: { dependsOnJobId: first.id, kind: 'GENERATE_PREVIEW' },
    });
    await waitFor('media-ready:NAS');
    await waitFor('media-ready:EMBEDDING');
    payloads.length = 0;
    await db.eagleAssetProcessingJob.update({
      where: { id: first.id },
      data: { status: 'PROCESSING', lockedAt: new Date() },
    });
    await waitFor('media-progress');
    assert.ok(!payloads.some((value) => value.startsWith('media-ready:')));
    await db.eagleAssetProcessingJob.update({
      where: { id: first.id },
      data: { status: 'COMPLETED' },
    });
    await waitFor('media-ready:EMBEDDING');
    await waitFor('media-ready:NAS');
    await db.eagleTaskPolicy.create({
      data: { ownerId: f.owner, libraryMode: 'PHOTO', family: 'EMBEDDING', paused: true },
    });
    await waitFor('EagleTaskPolicy');
    const counts = { NAS: 0, EMBEDDING: 0 };
    const selectors = {
      NAS: {
        invalidate: () => {
          counts.NAS++;
        },
      },
      EMBEDDING: {
        invalidate: () => {
          counts.EMBEDDING++;
        },
      },
    };
    for (const payload of payloads) invalidateMediaCandidates(selectors, payload);
    assert.ok(counts.NAS > 0 && counts.EMBEDDING > 0);
  } finally {
    await listener.stop();
  }
});

test('real camera video playback belongs to VIDEO, respects deployment availability and retries only the video family', async () => {
  const f = await fixture();
  const job = await db.eagleAssetProcessingJob.findFirstOrThrow({ where: { ownerId: f.owner } });
  await db.eagleAssetProcessingJob.update({
    where: { id: job.id },
    data: {
      kind: 'GENERATE_PREVIEW',
      processorVersion: 'camera-video-playback-v1',
      status: 'FAILED',
    },
  });
  await db.eagleProcessingWorkerHeartbeat.updateMany({ data: { heartbeatAt: new Date(0) } });
  await db.eagleProcessingWorkerHeartbeat.create({
    data: {
      workerId: randomUUID(),
      version: 'synthetic',
      startedAt: new Date(),
      heartbeatAt: new Date(),
      activeJobCount: 0,
      capabilities: {
        background: true,
        jobKinds: ['GENERATE_PREVIEW'],
        video: false,
        tagBuilds: false,
        smartFolders: false,
        photoMap: false,
      },
    },
  });
  const service = new EagleTaskCenterService(db, 'PHOTO');
  const overview = await service.overview(f.owner);
  assert.equal(overview.groups.find((group) => group.id === 'VIDEO').failed, 1);
  assert.equal(overview.groups.find((group) => group.id === 'VIDEO').availability, 'DISABLED');
  assert.ok(!overview.groups.find((group) => group.id === 'BROWSE'));
  assert.deepEqual(await service.retry(f.owner, 'VIDEO'), { retried: 1 });
});
