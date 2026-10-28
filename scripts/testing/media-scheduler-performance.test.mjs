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
test('recent uploads use a time-leading covering index instead of probing every historical object key', async () => {
  const rows =
    await db.$queryRaw`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='UploadSession' AND indexname='UploadSession_recent_freshness_cover_idx'`;
  assert.equal(rows.length, 1);
  assert.match(
    rows[0].indexdef,
    /\("completedAt" DESC\) INCLUDE \("objectKey", "uploaderId", "libraryMode"\)/,
  );
  assert.match(rows[0].indexdef, /WHERE \(status = 'COMPLETED'/);
});

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

test('current source identity remains unique and asset validation stays covered', async () => {
  const indexes =
    await db.$queryRaw`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='UploadSession' AND indexname='UploadSession_objectKey_key'`;
  assert.equal(indexes.length, 1, 'immutable object identity must stay unique');
  assert.match(indexes[0].indexdef, /CREATE UNIQUE INDEX/);
  assert.match(indexes[0].indexdef, /\("objectKey"\)/);
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
test('historical backlog discovery reads recent upload facts once even under a nested-loop plan', async () => {
  const f = await fixture(4000);
  await db.eagleAsset.updateMany({
    where: { ownerId: f.owner },
    data: { libraryAddedAt: new Date('2001-01-01'), chronologicalAt: new Date('2001-01-01') },
  });
  await db.$executeRaw`INSERT INTO "UploadSession" (id,"uploaderId","libraryMode","originalName","mimeType",size,"objectKey","multipartUploadId",status,"completedAt","updatedAt")
    SELECT 'upload-'||id,"ownerId","libraryMode",'synthetic.jpg','image/jpeg',1,"originalObjectKey",'synthetic','COMPLETED','2001-01-01'::timestamp,now() FROM "EagleAsset" WHERE "ownerId"=${f.owner}`;
  await db.$executeRaw`ANALYZE "UploadSession"`;
  await db.$executeRaw`ANALYZE "EagleMediaJob"`;
  let query;
  await selectScheduledMediaCandidates({ $queryRaw: (q) => { query = q; return []; } },
    input, true, false, { resource: 'EMBEDDING', historyOnly: true });
  const plan = await db.$transaction(async (tx) => {
    // Reproduce the production access path without relying on local cost estimates.
    await tx.$executeRawUnsafe('SET LOCAL enable_hashjoin=off');
    await tx.$executeRawUnsafe('SET LOCAL enable_mergejoin=off');
    await tx.$executeRawUnsafe('SET LOCAL enable_material=off');
    const rows = await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`);
    return rows[0]['QUERY PLAN'][0];
  }, { timeout: 60000 });
  const uploadScans = [];
  const visit = (node) => {
    if (node['Relation Name'] === 'UploadSession') uploadScans.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan.Plan);
  assert.ok(uploadScans.length, 'the real query must consult upload freshness');
  assert.ok(uploadScans.every((node) => node['Actual Loops'] <= 1),
    `recent uploads must be read once, not per historical asset: ${uploadScans.map((node) => node['Actual Loops'])}`);
  const actual = await db.$queryRaw(query);
  assert.equal(actual.length, 50);
  assert.ok(actual.every((row) => row.ownerId === f.owner));
  await db.eagleAssetProcessingJob.updateMany({ where: { ownerId: f.owner }, data: { status: 'COMPLETED' } });
});

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

test('restricting upload freshness preserves recent/history ordering, replacements and owner/mode boundaries', async () => {
  const f = await fixture(6);
  const assets = await db.eagleAsset.findMany({
    where: { ownerId: f.owner },
    orderBy: { id: 'asc' },
  });
  const now = Date.now(),
    hour = 3600_000;
  for (let n = 0; n < assets.length; n++) {
    await db.eagleAsset.update({
      where: { id: assets[n].id },
      data: {
        libraryAddedAt: new Date(now - (n === 2 ? 2 : 72) * hour),
        chronologicalAt: new Date(now - 96 * hour + n * 1000),
      },
    });
    await db.uploadSession.create({
      data: {
        uploaderId: f.owner,
        libraryMode: n === 5 ? 'MATERIAL' : 'PHOTO',
        originalName: 'synthetic.jpg',
        mimeType: 'image/jpeg',
        size: 1,
        objectKey: n === 3 ? `users/${f.owner}/superseded-source` : assets[n].originalObjectKey,
        multipartUploadId: randomUUID(),
        status: 'COMPLETED',
        completedAt: n === 4 ? null : new Date(now - ([0, 3, 5].includes(n) ? 1 : 72) * hour),
      },
    });
  }
  for (const options of [{}, { freshOnly: true }, { historyOnly: true }]) {
    let query;
    await selectScheduledMediaCandidates(
      {
        $queryRaw: async (q) => {
          query = q;
          return [];
        },
      },
      { ...input, take: 1000 },
      true,
      false,
      { resource: 'EMBEDDING', ...options },
    );
    const reference = query.text.replace(
      'AND current_upload."completedAt">=now()-interval \'24 hours\'',
      '',
    );
    assert.notEqual(
      reference,
      query.text,
      'the reference removes only the optimized horizon restriction',
    );
    const expected = await db.$queryRawUnsafe(reference, ...query.values);
    const actual = await db.$queryRaw(query);
    assert.deepEqual(
      actual.map((x) => x.id),
      expected.map((x) => x.id),
    );
    const own = actual
      .filter((x) => x.ownerId === f.owner)
      .map((x) => x.assetId)
      .sort();
    const indices = options.freshOnly
      ? [0, 2]
      : options.historyOnly
        ? [1, 3, 4, 5]
        : [0, 1, 2, 3, 4, 5];
    assert.deepEqual(own, indices.map((n) => assets[n].id).sort());
  }
  await db.eagleAssetProcessingJob.updateMany({
    where: { ownerId: f.owner },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
});
