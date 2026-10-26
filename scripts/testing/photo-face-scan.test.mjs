import console from 'node:console';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import {
  queuePhotoFaceScan,
  PHOTO_FACE_MODEL_VERSION,
} from '../../packages/library-persistence/dist/index.js';
import { EagleTaskCenterService } from '../../apps/api/dist/eagle/eagle-task-center.service.js';
import { selectScheduledMediaCandidates } from '../../apps/worker/dist/scheduled-media-candidates.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
test('full scan is durable, idempotent, scoped, versioned and governed by existing pause rules', async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const previous = [process.env.PHOTO_FACE_PYTHON, process.env.PHOTO_FACE_MODEL_DIR];
  process.env.PHOTO_FACE_PYTHON = 'synthetic-python';
  process.env.PHOTO_FACE_MODEL_DIR = '/synthetic';
  try {
    await db.user.createMany({
      data: [owner, other].map((id) => ({
        id,
        email: `${id}@example.invalid`,
        passwordHash: 'synthetic-only',
      })),
    });
    const ordinary = Array.from({ length: 1201 }, () => ({ id: randomUUID() }));
    const variants = [
      { isPrivate: true },
      { ownerId: other },
      { libraryMode: 'MATERIAL' },
      { deletedAt: new Date() },
      { noPreview: true },
      { obsoletePreview: true },
      { editPreview: true },
    ].map((v) => ({ id: randomUUID(), ...v }));
    const assets = [...ordinary, ...variants].map((a) => ({
      ownerId: owner,
      libraryMode: 'PHOTO',
      ...a,
    }));
    await db.eagleAsset.createMany({
      data: assets.map((a) => ({
        id: a.id,
        ownerId: a.ownerId,
        libraryMode: a.libraryMode,
        isPrivate: a.isPrivate,
        deletedAt: a.deletedAt,
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        mediaRevision: 2,
        lifecycleStatus: 'READY',
        originalObjectKey: `users/${a.ownerId}/assets/${a.id}/original.jpg`,
      })),
    });
    await db.eagleAssetRendition.createMany({
      data: assets
        .filter((a) => !a.noPreview)
        .map((a) => ({
          ownerId: a.ownerId,
          libraryMode: a.libraryMode,
          assetId: a.id,
          kind: 'PREVIEW',
          revision: a.obsoletePreview ? 1 : 2,
          variant: a.editPreview ? 'edit' : 'default',
          status: 'READY',
          storageKey: `users/${a.ownerId}/assets/${a.id}/preview.jpg`,
          mimeType: 'image/jpeg',
          byteSize: 1,
        })),
    });
    const service = new EagleTaskCenterService(db, 'PHOTO');
    const coverage = async () =>
      (await service.overview(owner)).groups.find((g) => g.id === 'FACES');
    assert.equal((await coverage()).unscanned, 1201);
    await service.policy(owner, { family: 'FACES', paused: true });
    const accepted = await service.start(owner, 'FACES');
    assert.equal(accepted.queued, 1201);
    assert.equal((await coverage()).unscanned, 0);
    assert.equal((await coverage()).queued, 1201);
    assert.equal((await coverage()).policy.paused, true);
    assert.equal(
      await db.eagleAssetProcessingJob.count({
        where: { ownerId: owner, kind: 'ANALYZE_PHOTO_FACES', lane: 'INTERACTIVE' },
      }),
      0,
    );
    assert.equal((await queuePhotoFaceScan(db, owner, false)).queued, 0);
    await assert.rejects(new EagleTaskCenterService(db, 'MATERIAL').start(owner, 'FACES'), {
      status: 404,
    });
    const query = { where: { lane: 'BACKGROUND', kind: 'ANALYZE_PHOTO_FACES' }, take: 1500 };
    await db.eagleProcessingSetting.create({
      data: { ownerId: owner, libraryMode: 'PHOTO', mode: 'ALWAYS' },
    });
    assert.equal(
      (await selectScheduledMediaCandidates(db, query)).filter((j) => j.ownerId === owner).length,
      0,
    );
    await service.policy(owner, { family: 'FACES', paused: false });
    assert.equal(
      (await selectScheduledMediaCandidates(db, query)).filter((j) => j.ownerId === owner).length,
      1201,
    );
    // Completed scans with zero detections are still completed; retries never duplicate a failed job.
    const first = ordinary[0].id;
    await db.eagleAssetProcessingJob.updateMany({
      where: { assetId: first },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await db.eagleAssetProcessingJob.updateMany({
      where: { assetId: ordinary[1].id },
      data: { status: 'FAILED', attempts: 5 },
    });
    assert.equal((await queuePhotoFaceScan(db, owner, false)).queued, 0);
    assert.equal(
      (await service.overview(owner, false, 'HISTORY')).groups.find((g) => g.id === 'FACES')
        .completed,
      1,
    );
    assert.equal((await coverage()).failed, 1);
    assert.deepEqual(await service.retry(owner, 'FACES'), { retried: 1 });
    assert.equal((await queuePhotoFaceScan(db, owner, true)).queued, 1);
    const newConnection = new PrismaClient();
    try {
      assert.equal(
        await newConnection.eagleAssetProcessingJob.count({
          where: { ownerId: owner, processorVersion: PHOTO_FACE_MODEL_VERSION },
        }),
        1202,
      );
    } finally {
      await newConnection.$disconnect();
    }
    // Simultaneous starts accept a new eligible version only once.
    await db.eagleAsset.update({ where: { id: first }, data: { mediaRevision: 3 } });
    await db.eagleAssetRendition.create({
      data: {
        ownerId: owner,
        libraryMode: 'PHOTO',
        assetId: first,
        kind: 'PREVIEW',
        revision: 3,
        variant: 'default',
        status: 'READY',
        storageKey: `users/${owner}/assets/${first}/preview3.jpg`,
        mimeType: 'image/jpeg',
        byteSize: 1,
      },
    });
    const concurrent = await Promise.all([
      queuePhotoFaceScan(db, owner, false),
      queuePhotoFaceScan(db, owner, false),
    ]);
    assert.equal(
      concurrent.reduce((sum, result) => sum + result.queued, 0),
      1,
    );
    assert.equal(
      (await service.overview(owner, false, 'HISTORY')).groups.find((g) => g.id === 'FACES')
        ?.completed ?? 0,
      0,
    );
  } finally {
    await db.eagleAsset.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eagleTaskPolicy.deleteMany({ where: { ownerId: owner } });
    await db.eagleProcessingSetting.deleteMany({ where: { ownerId: owner } });
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await db.$disconnect();
    for (const [i, key] of ['PHOTO_FACE_PYTHON', 'PHOTO_FACE_MODEL_DIR'].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  }
});

test('50,000 synthetic photos measure coverage polling and one-shot acceptance cost', async () => {
  const { Prisma } = await import('@prisma/client');
  const { unscannedPhotoFacesSql } =
    await import('../../packages/library-persistence/dist/index.js');
  const { performance } = await import('node:perf_hooks');
  const owner = randomUUID();
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic-only' },
    });
    await db.$executeRaw`INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","lifecycleStatus","mediaRevision","updatedAt")
      SELECT gen_random_uuid()::text,${owner},'PHOTO','synthetic.jpg','Synthetic','synthetic','image/jpeg','jpeg',1,'users/'||${owner}||'/assets/'||i||'/original.jpg','READY',1,now() FROM generate_series(1,50000) i`;
    await db.$executeRaw`ANALYZE "EagleAsset"`;
    await db.$executeRaw`INSERT INTO "EagleAssetRendition" (id,"ownerId","libraryMode","assetId",kind,variant,revision,"storageKey","mimeType","byteSize",status,"updatedAt")
      SELECT gen_random_uuid()::text,"ownerId",'PHOTO',id,'PREVIEW','default',1,'users/'||${owner}||'/assets/'||id||'/preview.jpg','image/jpeg',1,'READY',now() FROM "EagleAsset" WHERE "ownerId"=${owner}`;
    await db.$executeRaw`ANALYZE "EagleAsset"`;
    await db.$executeRaw`ANALYZE "EagleAssetRendition"`;
    await db.$executeRaw`ANALYZE "EagleMediaJob"`;
    const before = await db.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT count(*) FROM (${unscannedPhotoFacesSql(owner, false)}) candidates`,
    );
    const began = performance.now();
    assert.equal((await queuePhotoFaceScan(db, owner, false)).queued, 50000);
    const queueMs = performance.now() - began;
    await db.$executeRaw`ANALYZE "EagleMediaJob"`;
    const after = await db.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT count(*) FROM (${unscannedPhotoFacesSql(owner, false)}) candidates`,
    );
    const overviewBegan = performance.now();
    const summary = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
        return new EagleTaskCenterService(tx, 'PHOTO').overview(owner);
      },
      { timeout: 15000 },
    );
    const overviewMs = Math.round(performance.now() - overviewBegan);
    const group = summary.groups.find((g) => g.id === 'FACES');
    assert.equal(group.unscanned, 0);
    assert.equal(group.queued, 50000);
    console.log(
      JSON.stringify({
        syntheticOnly: true,
        photos: 50000,
        coverageBeforeMs: before[0]['QUERY PLAN'][0]['Execution Time'],
        coverageAfterMs: after[0]['QUERY PLAN'][0]['Execution Time'],
        enqueueTransactionMs: Math.round(queueMs),
        productionTiming: false,
        overviewMs,
      }),
    );
  } finally {
    await db.eagleAsset.deleteMany({ where: { ownerId: owner } });
    await db.user.deleteMany({ where: { id: owner } });
    await db.$disconnect();
  }
});
