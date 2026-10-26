import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { backgroundScheduleAllows } from '../../packages/library-core/dist/index.js';
import { backgroundScheduleSql } from '../../packages/library-persistence/dist/index.js';
import { EagleTaskCenterService } from '../../apps/api/dist/eagle/eagle-task-center.service.js';
import { runSmartFolderBuildStep } from '../../apps/worker/dist/smart-folder-build.js';
import { claimNextScheduledTagBuild } from '../../apps/worker/dist/tag-build-lease.js';
import { selectScheduledMediaCandidates } from '../../apps/worker/dist/scheduled-media-candidates.js';
import { buildMediaWakeQuery } from '../../apps/worker/dist/job-wakeup-query.js';
import { EmbeddingClientError } from '../../apps/worker/dist/embedding-client.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());
async function fixture() {
  const owner = randomUUID(),
    other = randomUUID();
  await prisma.user.createMany({
    data: [owner, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  const asset = (options = {}) =>
    prisma.eagleAsset.create({
      data: {
        ownerId: owner,
        libraryMode: 'PHOTO',
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        mediaRevision: 2,
        originalObjectKey: `users/${owner}/assets/${randomUUID()}/original.jpg`,
        ...options,
      },
    });
  const job = (a, options = {}) =>
    prisma.eagleAssetProcessingJob.create({
      data: {
        ownerId: a.ownerId,
        libraryMode: a.libraryMode,
        assetId: a.id,
        assetRevision: a.mediaRevision,
        kind: 'GENERATE_EMBEDDING',
        lane: 'BACKGROUND',
        ...options,
      },
    });
  return { owner, other, asset, job, service: new EagleTaskCenterService(prisma, 'PHOTO') };
}

test('task overview uses current visible resources and never crosses owner or mode', async () => {
  const f = await fixture();
  await f.job(await f.asset());
  await f.job(await f.asset({ isPrivate: true }));
  await f.job(await f.asset({ ownerId: f.other }));
  await f.job(await f.asset({ libraryMode: 'MATERIAL' }));
  await f.job(await f.asset(), { assetRevision: 1 });
  await f.job(await f.asset({ deletedAt: new Date() }));
  assert.equal(
    (await f.service.overview(f.owner)).groups.find((g) => g.id === 'EMBEDDING').queued,
    1,
  );
  assert.equal(
    (await f.service.overview(f.owner, true)).groups.find((g) => g.id === 'EMBEDDING').queued,
    2,
  );
  assert.equal(
    (await new EagleTaskCenterService(prisma).overview(f.owner)).groups.find(
      (g) => g.id === 'EMBEDDING',
    ).queued,
    1,
  );
});

test('family retry fences privacy, ownership, mode and media version and keeps optional analysis from blocking browsing', async () => {
  const f = await fixture();
  const a = await f.asset({ lifecycleStatus: 'READY' });
  const visible = await f.job(a, { status: 'FAILED', attempts: 5 });
  const hidden = await f.job(await f.asset({ isPrivate: true }), { status: 'FAILED' });
  const foreign = await f.job(await f.asset({ ownerId: f.other }), { status: 'FAILED' });
  const material = await f.job(await f.asset({ libraryMode: 'MATERIAL' }), { status: 'FAILED' });
  const obsolete = await f.job(await f.asset(), { assetRevision: 1, status: 'FAILED' });
  assert.deepEqual(await f.service.retry(f.owner, 'EMBEDDING'), { retried: 1 });
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUnique({ where: { id: visible.id } })).status,
    'PENDING',
  );
  for (const row of [hidden, foreign, material, obsolete])
    assert.equal(
      (await prisma.eagleAssetProcessingJob.findUnique({ where: { id: row.id } })).status,
      'FAILED',
    );
  assert.equal(
    (await prisma.eagleAsset.findUnique({ where: { id: a.id } })).lifecycleStatus,
    'READY',
  );
  await assert.rejects(f.service.retry(f.other, 'VIDEO'), { status: 404 });
});

test('database scheduling agrees with shared rules and pausing preserves snapshot progress', async () => {
  const f = await fixture();
  for (const schedule of [
    { mode: 'MANUAL', nightStart: '23:00', nightEnd: '06:00' },
    { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' },
    { mode: 'NIGHT', nightStart: '09:00', nightEnd: '12:00' },
    { mode: 'NIGHT', nightStart: '23:00', nightEnd: '06:00' },
    { mode: 'NIGHT', nightStart: '01:00', nightEnd: '01:00' },
  ]) {
    await prisma.eagleProcessingSetting.upsert({
      where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } },
      create: { ownerId: f.owner, libraryMode: 'PHOTO', ...schedule },
      update: schedule,
    });
    const [row] = await prisma.$queryRaw(
      Prisma.sql`SELECT now() AS at, ${backgroundScheduleSql(Prisma.sql`${f.owner}`, Prisma.sql`'PHOTO'::"LibraryMode"`)} AS allowed`,
    );
    assert.equal(row.allowed, backgroundScheduleAllows(schedule, row.at));
  }
  await prisma.eagleProcessingSetting.update({
    where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } },
    data: { mode: 'MANUAL' },
  });
  const folder = await prisma.eagleSmartFolder.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      name: 'Synthetic',
      normalizedName: randomUUID(),
      queryJson: {},
    },
  });
  const snapshot = await prisma.eagleSmartFolderSemanticSnapshot.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      folderId: folder.id,
      intentKey: randomUUID(),
      text: 'Synthetic',
      breadth: 'BALANCED',
      threshold: 0.5,
      spaceId: `test-${randomUUID()}`,
      scannedCount: 500,
      cursor: 'synthetic-cursor',
    },
  });
  let embeds = 0;
  await runSmartFolderBuildStep(prisma, snapshot.spaceId, async () => {
    embeds++;
    return { embedding: [] };
  });
  assert.equal(embeds, 0);
  const retained = await prisma.eagleSmartFolderSemanticSnapshot.findUnique({
    where: { id: snapshot.id },
  });
  assert.equal(retained.cursor, 'synthetic-cursor');
  assert.equal(retained.scannedCount, 500);
  assert.equal(retained.attempts, 0);
  await prisma.eagleProcessingSetting.update({
    where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } },
    data: { mode: 'ALWAYS' },
  });
  // Use the database queue clock, including when the Docker VM differs slightly.
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot" SET "availableAt"=now()-interval '1 second' WHERE id=${snapshot.id}`,
  );
  assert.equal(
    await runSmartFolderBuildStep(
      prisma,
      snapshot.spaceId,
      async () => {
        throw new Error('Offline work must not call the model');
      },
      false,
    ),
    false,
  );
  assert.equal(
    await runSmartFolderBuildStep(prisma, snapshot.spaceId, async () => {
      throw new EmbeddingClientError('HOST_UNAVAILABLE', 'synthetic offline');
    }),
    true,
  );
  const deferred = await prisma.eagleSmartFolderSemanticSnapshot.findUnique({
    where: { id: snapshot.id },
  });
  assert.equal(deferred.attempts, 0);
  assert.equal(deferred.cursor, 'synthetic-cursor');
  assert.equal(deferred.errorCode, 'WAITING_EMBEDDING_HOST');
  const cachedVector = `[1,${Array(1023).fill(0).join(',')}]`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot" SET "queryVector"=${cachedVector}::vector,"availableAt"=now()-interval '1 second' WHERE id=${snapshot.id}`,
  );
  assert.equal(
    await runSmartFolderBuildStep(
      prisma,
      snapshot.spaceId,
      async () => {
        throw new Error('Cached index must not call the model');
      },
      false,
    ),
    true,
  );
  assert.equal(
    (await prisma.eagleSmartFolderSemanticSnapshot.findUnique({ where: { id: snapshot.id } }))
      .status,
    'READY',
  );
});

test('scheduled tag claims skip paused owners without consuming their attempts', async () => {
  const f = await fixture();
  for (const [ownerId, mode] of [
    [f.owner, 'MANUAL'],
    [f.other, 'ALWAYS'],
  ]) {
    await prisma.eagleProcessingSetting.create({ data: { ownerId, libraryMode: 'PHOTO', mode } });
    const tag = await prisma.eagleManualTag.create({
      data: { ownerId, libraryMode: 'PHOTO', name: 'Synthetic', normalizedName: randomUUID() },
    });
    await prisma.eagleTagSemanticBuild.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        tagId: tag.id,
        availableAt: new Date('1900-01-01T00:00:00Z'),
      },
    });
  }
  const build = await claimNextScheduledTagBuild(prisma);
  assert.equal(build.ownerId, f.other);
  assert.equal(
    (await prisma.eagleTagSemanticBuild.findFirst({ where: { ownerId: f.owner } })).attempts,
    0,
  );
});

test('fixed light-work order ignores legacy priority, applies pause before the limit and preserves FIFO turns', async () => {
  const f = await fixture();
  await prisma.eagleProcessingSetting.create({
    data: { ownerId: f.owner, libraryMode: 'PHOTO', mode: 'ALWAYS' },
  });
  const sameDates = {
    libraryAddedAt: new Date('2100-01-01Z'),
    chronologicalAt: new Date('2020-01-01Z'),
  };
  const normal = await f.job(await f.asset(sameDates), {
    availableAt: new Date('1900-01-01T00:00:00Z'),
  });
  const urgent = await f.job(await f.asset(sameDates), {
    kind: 'EXTRACT_COLOR_PALETTE',
    availableAt: new Date('1900-01-02T00:00:00Z'),
  });
  await f.service.policy(f.owner, { family: 'COLOR', paused: false });
  await prisma.eagleTaskPolicy.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      family: 'EMBEDDING',
      paused: false,
      priority: 1,
    },
  });
  const query = { where: { lane: 'BACKGROUND', kind: { not: 'GENERATE_AI_TAGS' } }, take: 50 };
  assert.equal((await selectScheduledMediaCandidates(prisma, query, true))[0].id, urgent.id);
  assert.equal((await selectScheduledMediaCandidates(prisma, query, false))[0].id, normal.id);
  await f.service.policy(f.owner, { family: 'COLOR', paused: true, priority: 1 });
  assert.ok(
    !(await selectScheduledMediaCandidates(prisma, query)).some((row) => row.id === urgent.id),
  );
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUnique({ where: { id: urgent.id } })).attempts,
    0,
  );
  const wakes = await prisma.$queryRaw(buildMediaWakeQuery());
  assert.ok(!wakes.some((row) => row.ownerId === f.owner && row.kind === 'EXTRACT_COLOR_PALETTE'));
  for (let index = 0; index < 51; index++)
    await f.job(await f.asset(), { kind: 'EXTRACT_COLOR_PALETTE' });
  assert.equal(
    (await selectScheduledMediaCandidates(prisma, { ...query, take: 1 }))[0].id,
    normal.id,
  );
  assert.ok(
    !(await selectScheduledMediaCandidates(prisma, query, true, true)).some(
      (row) => row.id === normal.id,
    ),
  );
  await f.job(await f.asset(), { kind: 'GENERATE_IMAGE_PYRAMID', assetRevision: 1 });
  assert.ok(
    !(await prisma.$queryRaw(buildMediaWakeQuery())).some(
      (row) => row.ownerId === f.owner && row.kind === 'GENERATE_IMAGE_PYRAMID',
    ),
  );
  const material = await new EagleTaskCenterService(prisma, 'MATERIAL').overview(f.owner);
  assert.ok(!material.groups.some((group) => group.policy?.paused));
});

test('retired generation is absent from overview, claims and retry while 2B work remains active', async () => {
  const f = await fixture();
  const a = await f.asset();
  for (let n = 0; n < 60; n++)
    await f.job(a, { kind: 'GENERATE_AI_TAGS', processorVersion: `legacy-${n}`, status: 'FAILED' });
  const active = await f.job(a);
  const summary = await f.service.overview(f.owner);
  assert.equal(
    summary.groups.some((g) => g.id === 'AI_TAGS'),
    false,
  );
  assert.equal(
    summary.groups.some((g) => g.steps.some((s) => s.id === 'GENERATE_AI_TAGS')),
    false,
  );
  const query = { where: { lane: 'BACKGROUND', kind: { not: 'GENERATE_AI_TAGS' } }, take: 50 };
  await prisma.eagleProcessingSetting.upsert({
    where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } },
    create: { ownerId: f.owner, libraryMode: 'PHOTO', mode: 'ALWAYS', aiTagManualEnabled: true },
    update: { mode: 'ALWAYS', aiTagManualEnabled: true },
  });
  await prisma.eagleAssetProcessingJob.updateMany({
    where: { ownerId: f.owner, kind: 'GENERATE_AI_TAGS' },
    data: { status: 'PENDING' },
  });
  assert.ok(
    (await selectScheduledMediaCandidates(prisma, query)).every(
      (job) => job.kind !== 'GENERATE_AI_TAGS',
    ),
  );
  assert.ok(
    (await selectScheduledMediaCandidates(prisma, query)).some((job) => job.id === active.id),
  );
  await prisma.eagleAssetProcessingJob.updateMany({
    where: { ownerId: f.owner, kind: 'GENERATE_AI_TAGS' },
    data: { status: 'FAILED' },
  });
  await assert.rejects(f.service.retry(f.owner, 'BROWSE'), { status: 404 });
});

test('retirement migration revokes old leases and preserves generated tags and successful history', async () => {
  const f = await fixture();
  const a = await f.asset();
  const legacy = await f.job(a, {
    kind: 'GENERATE_AI_TAGS',
    status: 'PROCESSING',
    leaseVersion: 3,
    lockedAt: new Date(),
  });
  const active = await f.job(a);
  const run = await prisma.eagleAiAnalysisRun.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      assetId: a.id,
      assetRevision: a.mediaRevision,
      provider: 'OLLAMA',
      model: 'historical',
      promptVersion: 'historical',
      status: 'SUCCEEDED',
    },
  });
  const tag = await prisma.eagleAiTag.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      name: 'Historical',
      normalizedName: 'historical',
    },
  });
  const link = await prisma.eagleAssetAiTag.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      assetId: a.id,
      aiTagId: tag.id,
      analysisRunId: run.id,
      confidence: 1,
    },
  });
  const sql = await readFile(
    new URL(
      '../../apps/api/prisma/migrations/20261024150000_retire_ai_tag_generation/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const rollback = new Error('Rollback isolated migration verification');
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      for (const statement of sql.split(';').filter((part) => part.trim()))
        await tx.$executeRawUnsafe(statement);
      const retired = await tx.eagleAssetProcessingJob.findUniqueOrThrow({
        where: { id: legacy.id },
      });
      assert.equal(retired.status, 'FAILED');
      assert.equal(retired.leaseVersion, 4);
      assert.equal(retired.lastError, 'FEATURE_RETIRED');
      assert.equal(retired.lockedAt, null);
      assert.equal(
        (await tx.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: active.id } })).status,
        'PENDING',
      );
      assert.equal(
        (await tx.eagleAiAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).status,
        'SUCCEEDED',
      );
      assert.ok(await tx.eagleAiTag.findUnique({ where: { id: tag.id } }));
      assert.ok(
        await tx.eagleAssetAiTag.findFirst({
          where: {
            ownerId: link.ownerId,
            libraryMode: link.libraryMode,
            assetId: link.assetId,
            aiTagId: link.aiTagId,
            analysisRunId: link.analysisRunId,
          },
        }),
      );
      throw rollback;
    }),
    (error) => error === rollback,
  );
});

test('separate resource claims prioritize new uploads over newer-dated historical photos, then newest historical capture', async () => {
  const f = await fixture();
  await prisma.eagleProcessingSetting.create({
    data: { ownerId: f.owner, libraryMode: 'PHOTO', mode: 'ALWAYS' },
  });
  const recent = await f.asset({
    libraryAddedAt: new Date(),
    chronologicalAt: new Date('2010-01-01Z'),
  });
  const historyNew = await f.asset({
    libraryAddedAt: new Date('2020-01-01Z'),
    chronologicalAt: new Date('2025-01-01Z'),
  });
  const historyOld = await f.asset({
    libraryAddedAt: new Date('2021-01-01Z'),
    chronologicalAt: new Date('2022-01-01Z'),
  });
  const jobs = [];
  for (const a of [historyOld, historyNew, recent]) jobs.push(await f.job(a));
  const browse = await f.job(recent, { kind: 'GENERATE_RENDITIONS', lane: 'INTERACTIVE' });
  const input = { where: { lane: 'BACKGROUND' }, take: 10000 };
  const select = async (resource, freshOnly = false) =>
    (
      await selectScheduledMediaCandidates(prisma, input, true, false, { resource, freshOnly })
    ).filter((row) => row.ownerId === f.owner);
  assert.deepEqual(
    (await select('EMBEDDING')).map((row) => row.assetId),
    [recent.id, historyNew.id, historyOld.id],
  );
  assert.deepEqual(
    (await select('EMBEDDING', true)).map((row) => row.assetId),
    [recent.id],
  );
  const historicalOnly = (
    await selectScheduledMediaCandidates(prisma, input, true, false, {
      resource: 'EMBEDDING',
      historyOnly: true,
    })
  ).filter((row) => row.ownerId === f.owner);
  assert.deepEqual(
    historicalOnly.map((row) => row.assetId),
    [historyNew.id, historyOld.id],
  );
  assert.equal((await select('NAS')).length, 0);
  const nas = (
    await selectScheduledMediaCandidates(
      prisma,
      { ...input, where: { lane: 'INTERACTIVE' } },
      true,
      false,
      { resource: 'NAS' },
    )
  ).filter((row) => row.ownerId === f.owner);
  assert.deepEqual(
    nas.map((row) => row.id),
    [browse.id],
  );
  await prisma.eagleAssetProcessingJob.update({
    where: { id: jobs[2].id },
    data: { status: 'PROCESSING', lockedAt: new Date() },
  });
  const newlyUploaded = await f.asset({
    libraryAddedAt: new Date(Date.now() + 1000),
    chronologicalAt: new Date('2000-01-01Z'),
  });
  const next = await f.job(newlyUploaded);
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "EagleMediaJob" SET "availableAt"=now()-interval '1 second' WHERE id=${next.id}`,
  );
  assert.equal((await select('EMBEDDING'))[0].id, next.id);
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUnique({ where: { id: jobs[2].id } })).status,
    'PROCESSING',
  );
});

test('historical import records without a live protocol never imply a running background task', async () => {
  const f = await fixture();
  const library = await prisma.eagleExternalLibrary.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      externalLibraryId: randomUUID(),
      displayName: 'Synthetic historical import',
    },
  });
  const run = await prisma.eagleImportRun.create({
    data: {
      ownerId: f.owner,
      libraryMode: 'PHOTO',
      externalLibraryId: library.id,
      idempotencyKey: randomUUID(),
      manifestVersion: 1,
      status: 'RUNNING',
      declaredItemCount: 100,
      importedItemCount: 97,
      failedItemCount: 2,
      stagedItemCount: 1,
      updatedAt: new Date('2026-08-18T14:15:43Z'),
    },
  });
  for (const privateVisible of [false, true])
    assert.equal(
      (await f.service.overview(f.owner, privateVisible)).groups.some(
        (group) => group.id === 'IMPORTS',
      ),
      false,
    );
  assert.equal(
    (await prisma.eagleImportRun.findUniqueOrThrow({ where: { id: run.id } })).status,
    'RUNNING',
    'Overview must not rewrite historical import state',
  );
});

test('decision SQL and core agree for every combination of wait gates', async () => {
  const { TASK_GATES, decideTask } = await import('../../packages/library-core/dist/index.js');
  const { taskWaitReasonSql, taskRunnableSql } =
    await import('../../packages/library-persistence/dist/index.js');
  // One SQL batch checks all gate combinations, including precedence collisions.
  const cases = Array.from({ length: 1 << TASK_GATES.length }, (_, mask) => {
    const facts = Object.fromEntries(
      TASK_GATES.map(([gate], index) => [gate, Boolean(mask & (1 << index))]),
    );
    const sqlFacts = Object.fromEntries(
      Object.entries(facts).map(([gate, value]) => [gate, Prisma.sql`${value}`]),
    );
    return {
      facts,
      sql: Prisma.sql`SELECT ${mask}::integer AS id, ${taskWaitReasonSql(sqlFacts)} AS reason, ${taskRunnableSql(sqlFacts)} AS runnable`,
    };
  });
  const rows = [];
  for (let offset = 0; offset < cases.length; offset += 128) {
    rows.push(
      ...(await prisma.$queryRaw(
        Prisma.join(
          cases.slice(offset, offset + 128).map((entry) => entry.sql),
          ' UNION ALL ',
        ),
      )),
    );
  }
  for (const row of rows) {
    const decision = decideTask(cases[row.id].facts);
    assert.equal(row.reason, decision.reason);
    assert.equal(row.runnable, decision.runnable);
  }
});

test('claims, interruption recovery and terminal completion leave atomic scoped history, not heartbeat noise', async () => {
  const { claimNextMediaJob } = await import('../../apps/worker/dist/job-claim.js');
  const f = await fixture();
  const a = await f.asset();
  const job = await f.job(a);
  const options = {
    now: new Date(),
    selectCandidates: async () => [job],
    canClaimBackground: async () => true,
    onLeaseExhausted: async () => {
      throw Error('unexpected');
    },
  };
  const results = await Promise.all([
    claimNextMediaJob(prisma, options),
    claimNextMediaJob(prisma, options),
  ]);
  const claimed = results.find(Boolean);
  assert.ok(claimed);
  assert.equal(results.filter(Boolean).length, 1);
  const eventWhere = { ownerId: f.owner, libraryMode: 'PHOTO', jobId: job.id };
  assert.equal(await prisma.eagleMediaJobEvent.count({ where: eventWhere }), 2);
  const expired = await prisma.eagleAssetProcessingJob.update({
    where: { id: job.id },
    data: { lockedAt: new Date(Date.now() - 600001) },
  });
  assert.equal(await prisma.eagleMediaJobEvent.count({ where: eventWhere }), 2);
  const recovered = await claimNextMediaJob(prisma, {
    ...options,
    now: new Date(),
    selectCandidates: async () => [expired],
  });
  assert.equal(recovered.recoveryCount, 1);
  assert.equal(recovered.leaseVersion, claimed.leaseVersion + 1);
  assert.equal(
    (
      await prisma.eagleAssetProcessingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseVersion: claimed.leaseVersion },
        data: { status: 'COMPLETED' },
      })
    ).count,
    0,
  );
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.eagleAssetProcessingJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED' },
      });
      throw Error('rollback-test');
    }),
    /rollback-test/,
  );
  assert.equal(await prisma.eagleMediaJobEvent.count({ where: eventWhere }), 3);
  await prisma.eagleAssetProcessingJob.update({
    where: { id: job.id },
    data: { status: 'COMPLETED' },
  });
  assert.equal(await prisma.eagleMediaJobEvent.count({ where: eventWhere }), 4);
  assert.equal(
    (await f.service.overview(f.owner)).groups.some((group) => group.id === 'EMBEDDING'),
    false,
  );
  assert.equal(
    (await f.service.overview(f.owner, false, 'HISTORY')).groups.find(
      (group) => group.id === 'EMBEDDING',
    ).completed,
    1,
  );
  assert.equal(
    await prisma.eagleMediaJobEvent.count({ where: { ...eventWhere, ownerId: f.other } }),
    0,
  );
  assert.equal(
    await prisma.eagleMediaJobEvent.count({ where: { ...eventWhere, libraryMode: 'MATERIAL' } }),
    0,
  );
});

test('repeated lease interruption stops recovering, and explicit owner retry resets its recovery budget', async () => {
  const { claimNextMediaJob } = await import('../../apps/worker/dist/job-claim.js');
  const f = await fixture();
  const job = await f.job(await f.asset(), {
    status: 'PROCESSING',
    recoveryCount: 3,
    lockedAt: new Date(Date.now() - 600001),
  });
  let exhausted = 0;
  const result = await claimNextMediaJob(prisma, {
    selectCandidates: async () => [job],
    canClaimBackground: async () => true,
    onLeaseExhausted: async (candidate, expiredBefore) => {
      exhausted++;
      const { mediaFailure } = await import('../../packages/library-core/dist/index.js');
      const transition = mediaFailure(candidate, {
        message: 'MEDIA_LEASE_RECOVERY_EXHAUSTED',
        permanent: true,
        now: new Date(),
        expiredBefore: expiredBefore,
      });
      await prisma.eagleAssetProcessingJob.updateMany({
        where: transition.where,
        data: transition.data,
      });
    },
  });
  assert.equal(result, null);
  assert.ok(exhausted > 0);
  await f.service.retry(f.owner, 'EMBEDDING');
  const retried = await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(retried.status, 'PENDING');
  assert.equal(retried.recoveryCount, 0);
});

test('transition read API excludes other owners, libraries, private and superseded media', async () => {
  const f = await fixture();
  const publicAsset = await f.asset();
  const privateAsset = await f.asset({ isPrivate: true });
  await f.job(publicAsset);
  await f.job(privateAsset);
  await f.job(await f.asset({ ownerId: f.other }));
  await f.job(await f.asset({ libraryMode: 'MATERIAL' }));
  await f.job(await f.asset(), { assetRevision: 1 });
  assert.equal((await f.service.events(f.owner, 'EMBEDDING')).length, 1);
  assert.equal((await f.service.events(f.owner, 'EMBEDDING', true)).length, 2);
  await prisma.eagleAsset.update({ where: { id: publicAsset.id }, data: { isPrivate: true } });
  assert.equal((await f.service.events(f.owner, 'EMBEDDING')).length, 0);
  assert.equal(
    (await new EagleTaskCenterService(prisma, 'MATERIAL').events(f.owner, 'EMBEDDING')).length,
    1,
  );
});

test('retrying edited-copy rendering preserves the original source readiness', async () => {
  const f = await fixture();
  const source = await f.asset({ lifecycleStatus: 'READY' });
  const job = await f.job(source, {
    kind: 'RENDER_EDITED_COPY',
    lane: 'INTERACTIVE',
    status: 'FAILED',
  });
  assert.deepEqual(await f.service.retry(f.owner, 'BROWSE'), { retried: 1 });
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: source.id } })).lifecycleStatus,
    'READY',
  );
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).status,
    'PENDING',
  );
  await prisma.eagleAssetProcessingJob.update({
    where: { id: job.id },
    data: { status: 'COMPLETED' },
  });
});

test('an exhausted stale snapshot cannot fail an execution which renewed its heartbeat', async () => {
  const { claimNextMediaJob } = await import('../../apps/worker/dist/job-claim.js');
  const { mediaFailure, MEDIA_LEASE_MS } =
    await import('../../packages/library-core/dist/index.js');
  const f = await fixture();
  const now = new Date();
  const job = await f.job(await f.asset(), {
    status: 'PROCESSING',
    leaseVersion: 9,
    recoveryCount: 3,
    lockedAt: new Date(now.getTime() - MEDIA_LEASE_MS - 1),
  });
  let failed = -1;
  const result = await claimNextMediaJob(prisma, {
    now,
    laneOrder: ['BACKGROUND'],
    selectCandidates: async () => [job],
    canClaimBackground: async () => true,
    onLeaseExhausted: async (candidate, expiredBefore) => {
      await prisma.eagleAssetProcessingJob.update({
        where: { id: job.id },
        data: { lockedAt: now },
      });
      const transition = mediaFailure(candidate, {
        message: 'MEDIA_LEASE_RECOVERY_EXHAUSTED',
        permanent: true,
        now: now,
        expiredBefore: expiredBefore,
      });
      failed = (
        await prisma.eagleAssetProcessingJob.updateMany({
          where: transition.where,
          data: transition.data,
        })
      ).count;
    },
  });
  assert.equal(result, null);
  assert.equal(failed, 0);
  const live = await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(live.status, 'PROCESSING');
  assert.equal(live.leaseVersion, 9);
  assert.equal(
    await prisma.eagleMediaJobEvent.count({ where: { jobId: job.id, toStatus: 'FAILED' } }),
    0,
  );
  await prisma.eagleAssetProcessingJob.update({
    where: { id: job.id },
    data: { status: 'COMPLETED' },
  });
});

test('overview and claim share expiring capacity, dependency and retry facts', async () => {
  const f = await fixture();
  await prisma.eagleProcessingSetting.create({
    data: { ownerId: f.owner, libraryMode: 'PHOTO', mode: 'ALWAYS' },
  });
  const workerId = randomUUID();
  await prisma.eagleProcessingWorkerHeartbeat.create({
    data: {
      workerId,
      version: 'synthetic',
      startedAt: new Date(),
      heartbeatAt: new Date(),
      activeJobCount: 0,
      capabilities: {
        background: true,
        embedding: 'READY',
        jobKinds: null,
        video: true,
        tagBuilds: true,
        smartFolders: true,
        photoMap: true,
      },
    },
  });
  try {
    const busy = await f.job(await f.asset(), {
      availableAt: new Date('2100-01-01Z'),
      lastError: 'WAITING_EMBEDDING_CAPACITY',
    });
    const expired = await f.job(await f.asset(), {
      availableAt: new Date('2000-01-01Z'),
      lastError: 'WAITING_EMBEDDING_CAPACITY',
    });
    await f.job(await f.asset({ isPrivate: true }), {
      availableAt: new Date('2100-01-01Z'),
      lastError: 'WAITING_EMBEDDING_CAPACITY',
    });
    const dependency = await f.job(await f.asset(), { kind: 'PROBE_MEDIA', status: 'FAILED' });
    const blocked = await f.job(await f.asset(), {
      dependsOnJobId: dependency.id,
      availableAt: new Date('2100-01-01Z'),
      lastError: 'WAITING_EMBEDDING_CAPACITY',
    });
    const group = (await f.service.overview(f.owner)).groups.find((g) => g.id === 'EMBEDDING');
    assert.equal(group.waiting.find((w) => w.reason === 'MODEL_BUSY').count, 1);
    assert.equal(group.waiting.find((w) => w.reason === 'DEPENDENCY_FAILED').count, 1);
    assert.equal(group.waiting.find((w) => w.reason === 'QUEUED').count, 1);
    assert.equal(group.presentation.status, 'QUEUED');
    const candidates = () =>
      selectScheduledMediaCandidates(
        prisma,
        { where: { lane: 'BACKGROUND' }, take: 10000 },
        true,
        false,
        { resource: 'EMBEDDING' },
      );
    let own = (await candidates()).filter((j) => j.ownerId === f.owner);
    assert.ok(own.some((j) => j.id === expired.id));
    assert.ok(!own.some((j) => j.id === busy.id || j.id === blocked.id));
    await prisma.eagleAssetProcessingJob.update({
      where: { id: busy.id },
      data: { availableAt: new Date('2000-01-01Z') },
    });
    own = (await candidates()).filter((j) => j.ownerId === f.owner);
    assert.ok(own.some((j) => j.id === busy.id));
    assert.ok(
      !(await f.service.overview(f.owner)).groups
        .find((g) => g.id === 'EMBEDDING')
        .waiting.some((w) => w.reason === 'MODEL_BUSY'),
    );
  } finally {
    await prisma.eagleProcessingWorkerHeartbeat.delete({ where: { workerId } });
  }
});

test('recent source activity follows owner, mode, current version and private visibility', async () => {
  const f = await fixture();
  const own = await f.job(await f.asset(), { updatedAt: new Date('2024-01-01Z') });
  await f.job(await f.asset({ isPrivate: true }), { updatedAt: new Date('2025-01-01Z') });
  await f.job(await f.asset({ ownerId: f.other }), { updatedAt: new Date('2026-01-01Z') });
  await f.job(await f.asset({ libraryMode: 'MATERIAL' }), { updatedAt: new Date('2027-01-01Z') });
  await f.job(await f.asset(), { assetRevision: 1, updatedAt: new Date('2028-01-01Z') });
  const current = (includePrivate = false) =>
    f.service
      .overview(f.owner, includePrivate)
      .then((r) => r.groups.find((g) => g.id === 'EMBEDDING'));
  assert.equal((await current()).lastActivityAt, '2024-01-01T00:00:00.000Z');
  assert.equal((await current(true)).lastActivityAt, '2025-01-01T00:00:00.000Z');
  await prisma.eagleAssetProcessingJob.update({
    where: { id: own.id },
    data: { lockedAt: new Date(), updatedAt: new Date('2029-01-01Z') },
  });
  assert.equal((await current()).lastActivityAt, '2029-01-01T00:00:00.000Z');
  assert.ok((await current()).management);
});
