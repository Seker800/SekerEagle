import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { UploadFinalizationExecutor } from '../../apps/api/dist/upload-finalization-executor.js';
import { observePrismaAdapter } from './database-query-probe.mjs';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

const PHOTO = 'PHOTO';

async function insertSession(db, owner, mode = PHOTO, status = 'ASSEMBLED') {
  const sessionId = randomUUID();
  await db.$executeRaw`
    INSERT INTO "UploadSession"
      (id,"uploaderId","libraryMode",status,"originalName","mimeType",size,"objectKey","multipartUploadId","completionParts","updatedAt")
    VALUES (${sessionId},${owner},${mode}::"LibraryMode",${status}::"UploadSessionStatus",'photo.jpg','image/jpeg',5,
      ${`users/${owner}/assets/${sessionId}/original`},'synthetic','[{"PartNumber":1,"ETag":"etag"}]'::jsonb,now())
  `;
  return sessionId;
}

async function insertAsset(db, owner, mode = PHOTO) {
  const assetId = randomUUID();
  await db.eagleAsset.create({
    data: {
      id: assetId,
      ownerId: owner,
      libraryMode: mode,
      originalName: 'photo.jpg',
      displayName: 'photo',
      normalizedDisplayName: 'photo',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 5n,
      originalObjectKey: `users/${owner}/assets/${assetId}/original`,
      lifecycleStatus: 'READY',
    },
  });
  return assetId;
}

test('upload finalization queue publishes, backs off, fails terminally and takes over expired leases', async () => {
  const owner = randomUUID();
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic' },
    });
    // The shared integration database may hold jobs from earlier fixtures; this test owns the queue.
    await db.uploadFinalizationJob.deleteMany({});
    const completed = [];

    // Transient failure: the job returns to the queue with a future availableAt.
    const retrySession = await insertSession(db, owner);
    await db.uploadFinalizationJob.create({
      data: { uploadSessionId: retrySession, status: 'PENDING', availableAt: new Date() },
    });
    let fail = true;
    const upload = {
      recoverUploadSession: async (sessionId) => {
        if (sessionId !== retrySession) return null;
        if (fail) {
          await db.uploadSession.update({
            where: { id: retrySession },
            data: {
              status: 'FAILED',
              finalizationAttempts: { increment: 1 },
              lastError: 'synthetic transient',
            },
          });
          throw new Error('synthetic transient');
        }
        const assetId = await insertAsset(db, owner);
        await db.uploadSession.update({
          where: { id: retrySession },
          data: { status: 'COMPLETED', eagleAssetId: assetId },
        });
        return { uploadSessionId: retrySession, assetId, status: 'PROCESSING', duplicate: false };
      },
    };
    const executor = new UploadFinalizationExecutor(
      db,
      { PHOTO: upload, MATERIAL: upload },
      {
        finalizeUpload: async (...args) => {
          completed.push(args);
        },
      },
    );

    await executor.tick();
    let job = await db.uploadFinalizationJob.findUnique({
      where: { uploadSessionId: retrySession },
    });
    assert.equal(job.status, 'PENDING');
    assert.equal(job.attempts, 1);
    assert.ok(job.availableAt > new Date());

    fail = false;
    await db.uploadFinalizationJob.update({
      where: { id: job.id },
      data: { availableAt: new Date() },
    });
    await executor.tick();
    job = await db.uploadFinalizationJob.findUnique({ where: { uploadSessionId: retrySession } });
    assert.equal(job.status, 'COMPLETED');
    assert.equal(completed.length, 1);
    assert.equal(
      (await db.uploadSession.findUnique({ where: { id: retrySession } })).status,
      'COMPLETED',
    );

    // Terminal failure: ten attempts end the job instead of retrying forever.
    const terminalSession = await insertSession(db, owner);
    await db.uploadFinalizationJob.create({
      data: { uploadSessionId: terminalSession, status: 'PENDING', availableAt: new Date() },
    });
    const terminalExecutor = new UploadFinalizationExecutor(
      db,
      {
        PHOTO: {
          recoverUploadSession: async (sessionId) => {
            if (sessionId !== terminalSession) return null;
            await db.uploadSession.update({
              where: { id: terminalSession },
              data: { status: 'FAILED', finalizationAttempts: 10, lastError: 'synthetic invalid' },
            });
            throw new Error('synthetic invalid');
          },
        },
        MATERIAL: { recoverUploadSession: async () => null },
      },
      { finalizeUpload: async () => undefined },
    );
    await terminalExecutor.tick();
    const terminalJob = await db.uploadFinalizationJob.findUnique({
      where: { uploadSessionId: terminalSession },
    });
    assert.equal(terminalJob.status, 'FAILED');

    // Expired lease: a PROCESSING job older than five minutes is claimable again.
    const leaseSession = await insertSession(db, owner);
    const leaseAsset = await insertAsset(db, owner);
    await db.uploadFinalizationJob.create({
      data: {
        uploadSessionId: leaseSession,
        status: 'PROCESSING',
        attempts: 1,
        lockedAt: new Date(Date.now() - 6 * 60_000),
        availableAt: new Date(),
      },
    });
    const leaseExecutor = new UploadFinalizationExecutor(
      db,
      {
        PHOTO: {
          recoverUploadSession: async (sessionId) => {
            if (sessionId !== leaseSession) return null;
            await db.uploadSession.update({
              where: { id: leaseSession },
              data: { status: 'COMPLETED', eagleAssetId: leaseAsset },
            });
            return {
              uploadSessionId: leaseSession,
              assetId: leaseAsset,
              status: 'PROCESSING',
              duplicate: false,
            };
          },
        },
        MATERIAL: { recoverUploadSession: async () => null },
      },
      { finalizeUpload: async () => undefined },
    );
    await leaseExecutor.tick();
    assert.equal(
      (await db.uploadFinalizationJob.findUnique({ where: { uploadSessionId: leaseSession } }))
        .status,
      'COMPLETED',
    );

    // Aborted sessions leave no queued upload behind.
    const abortedSession = await insertSession(db, owner, PHOTO, 'ABORTED');
    await db.uploadFinalizationJob.create({
      data: { uploadSessionId: abortedSession, status: 'PENDING', availableAt: new Date() },
    });
    await leaseExecutor.tick();
    assert.equal(
      (await db.uploadFinalizationJob.findUnique({ where: { uploadSessionId: abortedSession } }))
        .status,
      'COMPLETED',
    );
  } finally {
    await db.uploadFinalizationJob.deleteMany({
      where: { uploadSession: { uploaderId: owner } },
    });
    await db.uploadSession.deleteMany({ where: { uploaderId: owner } });
    await db.eagleAsset.deleteMany({ where: { ownerId: owner } });
    await db.user.delete({ where: { id: owner } });
    await db.$disconnect();
  }
});

test('an idle finalization queue reads pending work rather than 120k completed upload history', async () => {
  const owner = randomUUID();
  let claim;
  const db = new PrismaClient({
    adapter: observePrismaAdapter(({ query }) => {
      if (query.includes('UploadFinalizationJob') && query.includes('WITH candidate'))
        claim = query;
    }),
  });
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic' },
    });
    await db.$executeRaw`INSERT INTO "UploadSession" (id,"uploaderId","libraryMode",status,"originalName","mimeType",size,"objectKey","multipartUploadId","updatedAt")
      SELECT ${owner}||'-history-'||n,${owner},'PHOTO'::"LibraryMode",'COMPLETED','history.jpg','image/jpeg',1,'users/'||${owner}||'/history/'||n,'synthetic',now() FROM generate_series(1,120000) n`;
    await db.$executeRaw`INSERT INTO "UploadFinalizationJob" (id,"uploadSessionId",status,"availableAt","updatedAt")
      SELECT gen_random_uuid()::text,id,'COMPLETED',now(),now() FROM "UploadSession" WHERE "uploaderId"=${owner}`;
    await db.$executeRawUnsafe('ANALYZE "UploadFinalizationJob"');
    const executor = new UploadFinalizationExecutor(
      db,
      {
        PHOTO: { recoverUploadSession: async () => assert.fail('history must not recover') },
        MATERIAL: { recoverUploadSession: async () => assert.fail('history must not recover') },
      },
      { finalizeUpload: async () => assert.fail('history must not publish') },
    );
    await executor.tick();
    assert.ok(claim, 'the production claim query must run');
    const plan = await db.$queryRawUnsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + claim);
    const root = plan[0]['QUERY PLAN'][0].Plan;
    const blocks = root['Shared Hit Blocks'] + root['Shared Read Blocks'];
    console.log(
      JSON.stringify({
        benchmark: 'idle-upload-finalization-claim',
        history: 120000,
        blocks,
        plan: root,
      }),
    );
    assert.ok(blocks < 64, `idle claim read ${blocks} blocks with no pending uploads`);
  } finally {
    await db.uploadFinalizationJob.deleteMany({
      where: { uploadSession: { uploaderId: owner } },
    });
    await db.uploadSession.deleteMany({ where: { uploaderId: owner } });
    await db.user.delete({ where: { id: owner } });
    await db.$disconnect();
  }
});
