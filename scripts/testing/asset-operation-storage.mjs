import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import console from 'node:console';
import sharp from 'sharp';
import { EagleMediaService } from '../../apps/api/dist/eagle/eagle-media.service.js';
// Real local PostgreSQL + S3 exercise; runner must supply an isolated, guarded test target.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleLibraryTransferService } from '../../apps/api/dist/eagle/eagle-library-transfer.service.js';
import { ObjectStorageService } from '../../apps/api/dist/storage/object-storage.service.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { prepareAssetPurge } from '../../apps/worker/dist/asset-purge.js';
import { MediaOutputAttempt } from '../../apps/worker/dist/media-output-attempt.js';
import { publishPyramid } from '../../apps/worker/dist/pyramid-publication.js';
import { buildPyramidDescriptor } from '../../apps/worker/dist/image-pyramid.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.S3_ENDPOINT).hostname));
const config = new ConfigService({
  ...process.env,
  S3_REGION: 'us-east-1',
  S3_PUBLIC_ENDPOINT: process.env.S3_ENDPOINT,
  S3_MAX_SOCKETS: 8,
  S3_CONNECTION_TIMEOUT_MS: 3000,
  S3_REQUEST_TIMEOUT_MS: 30000,
  S3_SOCKET_TIMEOUT_MS: 30000,
});
const storage = new ObjectStorageService(config);
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const db = new PrismaClient();
const bucket = process.env.S3_BUCKET;
const ownerId = randomUUID();
let worker;
let workerErrors = '';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((error) => {
    if (error.name !== 'BucketAlreadyOwnedByYou') throw error;
  });
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  const fixtures = [];
  const payloads = new Map();
  for (let i = 0; i < 8; i++) {
    const id = randomUUID();
    const original = Buffer.alloc(512 * 1024, i + 1);
    const originalObjectKey = `users/${ownerId}/assets/${id}/original.jpg`;
    const row = await db.eagleAsset.create({
      data: {
        id,
        ownerId,
        libraryMode: 'PHOTO',
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: original.length,
        originalObjectKey,
        lifecycleStatus: 'READY',
      },
    });
    const files = [{ key: originalObjectKey, bytes: original }];
    for (const [kind, variant, size] of [
      ['PREVIEW', 'default', 65536],
      ['THUMBNAIL', '256', 8192],
      ['THUMBNAIL', '512', 16384],
    ]) {
      const key = `users/${ownerId}/assets/${id}/${kind}-${variant}.webp`;
      const bytes = Buffer.alloc(size, i + 3);
      files.push({ key, bytes });
      await db.eagleAssetRendition.create({
        data: {
          ownerId,
          libraryMode: 'PHOTO',
          assetId: id,
          kind,
          variant,
          revision: row.mediaRevision,
          storageKey: key,
          mimeType: 'image/webp',
          byteSize: size,
          status: 'READY',
        },
      });
    }
    for (const file of files) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: file.key, Body: file.bytes }));
      payloads.set(file.key, digest(file.bytes));
    }
    fixtures.push(row);
  }
  let active = 0,
    peak = 0,
    heads = 0;
  const instrumented = {
    copyObject: async (...args) => {
      active++;
      peak = Math.max(peak, active);
      try {
        return await storage.copyObject(...args);
      } finally {
        active--;
      }
    },
    headObject: (...args) => {
      heads++;
      return storage.headObject(...args);
    },
  };
  const service = new EagleAssetOperationService(
    db,
    new EagleLibraryTransferService(db, instrumented, 'PHOTO'),
    new EagleService(db, undefined, 'PHOTO'),
    'PHOTO',
  );
  const principal = {
    sub: ownerId,
    kind: 'browser',
    authVersion: 0,
    canViewPrivate: false,
    privacyVisibleUntil: null,
  };
  const receipt = await service.enqueue(principal, {
    operationId: randomUUID(),
    kind: 'SEND',
    assetIds: fixtures.map((row) => row.id),
  });
  const start = performance.now();
  for (let i = 0; i < fixtures.length; i++) await service.tick();
  const sendMilliseconds = performance.now() - start;
  const result = (await service.list(ownerId)).find((row) => row.id === receipt.id);
  assert.equal(result.completed, fixtures.length);
  assert.equal(peak, 0);
  assert.equal(heads, 0);
  assert.equal(active, 0);
  const plans = await db.eagleLibraryTransfer.findMany({ where: { ownerId } });
  for (const plan of plans)
    for (const item of plan.plan) {
      for (const file of [item, ...(item.renditions ?? [])]) {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: file.targetKey }));
        assert.equal(
          digest(await object.Body.transformToByteArray()),
          payloads.get(file.sourceKey),
        );
      }
    }
  const targets = await db.eagleAsset.findMany({
    where: { ownerId, libraryMode: 'MATERIAL' },
    include: { renditions: true },
  });
  assert.equal(targets.length, 8);
  assert.ok(targets.every((row) => row.lifecycleStatus === 'READY' && row.renditions.length === 3));
  assert.equal(
    await db.eagleAsset.count({
      where: { ownerId, libraryMode: 'PHOTO', deletedAt: { not: null } },
    }),
    8,
  );
  // Purging a retired source cannot delete bytes now owned by its independent target.
  const sourceToPurge = fixtures[0];
  const purgeJob = await db.eagleAssetProcessingJob.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      assetId: sourceToPurge.id,
      assetRevision: sourceToPurge.mediaRevision,
      kind: 'PURGE_ASSET',
      processorVersion: 'synthetic-purge',
      status: 'PROCESSING',
      leaseVersion: 1,
    },
  });
  await db.$transaction((tx) => prepareAssetPurge(tx, purgeJob));
  const stillOwned = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: sourceToPurge.originalObjectKey }),
  );
  assert.equal(
    digest(await stillOwned.Body.transformToByteArray()),
    payloads.get(sourceToPurge.originalObjectKey),
  );
  // Trashing and restoring all targets uses one batch each and preserves real bytes.
  const material = new EagleAssetOperationService(
    db,
    undefined,
    new EagleService(db, undefined, 'MATERIAL'),
    'MATERIAL',
  );
  for (const kind of ['TRASH', 'RESTORE']) {
    const command = await material.enqueue(principal, {
      operationId: randomUUID(),
      kind,
      assetIds: targets.map((row) => row.id),
    });
    await material.tick();
    assert.equal((await material.list(ownerId)).find((row) => row.id === command.id).completed, 8);
  }
  const retrash = await material.enqueue(principal, {
    operationId: randomUUID(),
    kind: 'TRASH',
    assetIds: targets.map((row) => row.id),
  });
  await material.tick();
  assert.equal((await material.list(ownerId)).find((row) => row.id === retrash.id).completed, 8);
  const empty = await material.enqueue(principal, {
    operationId: randomUUID(),
    kind: 'EMPTY_TRASH',
    assetIds: [],
  });
  await material.tick();
  assert.equal((await material.list(ownerId)).find((row) => row.id === empty.id).completed, 1);
  // Exercise the actual worker's wake path, not a test loop that calls drain
  // repeatedly and could conceal a missing production self-wakeup.
  const cleanupKeys = Array.from(
    { length: 477 },
    (_, index) => `users/${ownerId}/cleanup-${index}`,
  );
  await Promise.all(
    cleanupKeys.map((Key) =>
      s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: Buffer.from('synthetic') })),
    ),
  );
  await db.eagleObjectDeletion.createMany({
    data: cleanupKeys.map((key) => ({
      ownerId,
      libraryMode: 'MATERIAL',
      objectKeys: [key],
      prefixes: [],
    })),
  });
  const delayedKey = `users/${ownerId}/cleanup-delayed`;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: delayedKey, Body: Buffer.from('synthetic') }),
  );
  const delayedUntil = new Date(Date.now() + 2500);
  await db.eagleObjectDeletion.create({
    data: {
      ownerId,
      libraryMode: 'MATERIAL',
      objectKeys: [delayedKey],
      prefixes: [],
      availableAt: delayedUntil,
    },
  });
  const cleanupStart = performance.now();
  worker = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env: {
      ...process.env,
      EAGLE_PROCESSING_JOB_KINDS: 'PURGE_ASSET',
      EAGLE_BACKGROUND_PROCESSING_ENABLED: 'false',
      MLX_EMBEDDING_URL: 'http://127.0.0.1:1',
      MLX_EMBEDDING_TOKEN: 'synthetic-only',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.resume();
  worker.stderr.on('data', (bytes) => {
    workerErrors = (workerErrors + bytes.toString()).slice(-2000);
  });
  const deadline = Date.now() + 20000;
  while (
    (await db.eagleObjectDeletion.count({ where: { ownerId } })) ||
    (await db.eagleAsset.count({ where: { ownerId, libraryMode: 'MATERIAL' } }))
  ) {
    if (Date.now() > deadline || worker.exitCode !== null)
      throw Error(`Local cleanup did not drain: ${workerErrors}`);
    await delay(50);
  }
  const cleanupMilliseconds = performance.now() - cleanupStart;
  assert.ok(new Date() >= delayedUntil, 'A future cleanup receipt must not run early');
  await assert.rejects(
    storage.headObject(delayedKey),
    (error) => error.$metadata?.httpStatusCode === 404,
  );
  for (const key of cleanupKeys)
    await assert.rejects(
      storage.headObject(key),
      (error) => error.$metadata?.httpStatusCode === 404,
    );
  // Sending removes all original source bytes while preserving the source audit identity.
  for (const key of payloads.keys())
    await assert.rejects(
      storage.headObject(key),
      (error) => error.$metadata?.httpStatusCode === 404,
    );
  for (const row of fixtures.filter((row) => row.id !== sourceToPurge.id)) {
    const source = await db.eagleAsset.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(source.transferredAt);
    assert.ok(source.purgeAfter);
  }
  assert.equal(
    (
      await new EagleService(db, undefined, 'PHOTO').listAssets(
        ownerId,
        { limit: 40 },
        { trash: true },
      )
    ).items.length,
    0,
  );
  for (const row of targets)
    for (const key of [row.originalObjectKey, ...row.renditions.map((r) => r.storageKey)])
      await assert.rejects(
        storage.headObject(key),
        (error) => error.$metadata?.httpStatusCode === 404,
      );
  // Real files: move a pyramid twice, resume a legacy-spelled frozen plan,
  // read the final tile through the shared media service, and retire both source directories.
  const pyramidAssetId = randomUUID();
  const tile = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#a34d76' } })
    .webp()
    .toBuffer();
  const originalKey = `users/${ownerId}/assets/${pyramidAssetId}/original.webp`;
  const pyramidPrefix = `users/${ownerId}/assets/${pyramidAssetId}/pyramids/1/pyramid-v1`;
  const pyramidSource = await db.eagleAsset.create({
    data: {
      id: pyramidAssetId,
      ownerId,
      libraryMode: 'PHOTO',
      originalName: 'roundtrip.webp',
      displayName: 'Roundtrip',
      normalizedDisplayName: 'roundtrip',
      mimeType: 'image/webp',
      format: 'webp',
      byteSize: tile.length,
      originalObjectKey: originalKey,
      lifecycleStatus: 'READY',
      mediaRevision: 1,
      width: 1,
      height: 1,
    },
  });
  const initialKeys = [originalKey, `${pyramidPrefix}/0/0_0.webp`];
  for (const [kind, variant] of [
    ['PREVIEW', 'default'],
    ['THUMBNAIL', '256'],
    ['THUMBNAIL', '512'],
  ]) {
    const key = `users/${ownerId}/assets/${pyramidAssetId}/${kind}-${variant}.webp`;
    initialKeys.push(key);
    await db.eagleAssetRendition.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId: pyramidAssetId,
        revision: 1,
        kind,
        variant,
        status: 'READY',
        storageKey: key,
        mimeType: 'image/webp',
        byteSize: tile.length,
        width: 1,
        height: 1,
      },
    });
  }
  for (const key of initialKeys)
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: tile }));
  await db.eagleImagePyramid.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      assetId: pyramidAssetId,
      revision: 1,
      processorVersion: 'pyramid-v1',
      status: 'READY',
      storagePrefix: pyramidPrefix,
      width: 1,
      height: 1,
      maxLevel: 0,
      tileSize: 512,
      overlap: 1,
      tileCount: 1,
      byteSize: tile.length,
    },
  });
  // A superseded writer must never change the immutable output adopted by a send.
  const staleJob = await db.eagleAssetProcessingJob.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      assetId: pyramidSource.id,
      assetRevision: 1,
      kind: 'GENERATE_IMAGE_PYRAMID',
      processorVersion: 'pyramid-v1',
      status: 'PROCESSING',
      leaseVersion: 1,
    },
  });
  const staleAttempt = new MediaOutputAttempt(db, pyramidSource, 'pyramids');
  await staleAttempt.prepare();
  const currentJob = await db.eagleAssetProcessingJob.update({
    where: { id: staleJob.id },
    data: { leaseVersion: 2 },
  });
  const currentAttempt = new MediaOutputAttempt(db, pyramidSource, 'pyramids');
  await currentAttempt.prepare();
  const currentTile = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#284f8d' },
  })
    .webp()
    .toBuffer();
  assert.notEqual(digest(currentTile), digest(tile));
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: currentAttempt.key('0/0_0.webp'),
      Body: currentTile,
    }),
  );
  const currentPublished = await publishPyramid(db, {
    job: currentJob,
    descriptor: buildPyramidDescriptor(1, 1),
    storagePrefix: currentAttempt.prefix,
    tileCount: 1,
    byteSize: BigInt(currentTile.length),
    outputAttempt: currentAttempt,
  });
  assert.equal(currentPublished, true);
  await currentAttempt.finish(currentPublished);
  const outbound = await new EagleLibraryTransferService(db, storage, 'PHOTO').send(
    ownerId,
    { operationId: randomUUID(), assetIds: [pyramidSource.id] },
    false,
  );
  const middleId = outbound.assets[0].assetId;
  const middle = await db.eagleAsset.findUniqueOrThrow({
    where: { id: middleId },
    include: { renditions: true, imagePyramids: true },
  });
  assert(!middle.imagePyramids[0].storagePrefix.endsWith('/'));
  assert.equal(middle.imagePyramids[0].storagePrefix, currentAttempt.prefix.replace(/\/+$/, ''));
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: staleAttempt.key('0/0_0.webp'), Body: tile }),
  );
  const stalePublished = await publishPyramid(db, {
    job: staleJob,
    descriptor: buildPyramidDescriptor(1, 1),
    storagePrefix: staleAttempt.prefix,
    tileCount: 1,
    byteSize: BigInt(tile.length),
    outputAttempt: staleAttempt,
  });
  assert.equal(stalePublished, false);
  await staleAttempt.finish(stalePublished);
  const orphanDeadline = Date.now() + 10000;
  while (await db.eagleObjectDeletion.count({ where: { ownerId } })) {
    if (Date.now() > orphanDeadline || worker.exitCode !== null)
      throw new Error('Output orphan cleanup did not drain');
    await delay(50);
  }
  await assert.rejects(
    storage.headObject(staleAttempt.key('0/0_0.webp')),
    (error) => error.$metadata?.httpStatusCode === 404,
  );
  const adopted = await new EagleMediaService(db, storage, 'MATERIAL').getPyramidTile(
    ownerId,
    middle.id,
    middle.imagePyramids[0].id,
    0,
    0,
    0,
  );
  const adoptedChunks = [];
  for await (const chunk of adopted.stream) adoptedChunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(adoptedChunks), currentTile);
  const retryId = randomUUID();
  const legacyDb = db.$extends({
    query: {
      eagleLibraryTransfer: {
        create({ args, query }) {
          if (Array.isArray(args.data.plan))
            args.data.plan = args.data.plan.map((item) => {
              const legacy = { ...item };
              delete legacy.storageAction;
              const root = `users/${ownerId}/assets/${item.targetId}`;
              return {
                ...legacy,
                targetKey: `${root}/original.webp`,
                renditions: (item.renditions ?? []).map((r) => ({
                  ...r,
                  targetKey: `${root}/transfer/${r.id}`,
                })),
                ...(item.pyramid
                  ? {
                      pyramid: {
                        ...item.pyramid,
                        targetPrefix: `${root}/pyramids/1/transfer-${item.pyramid.id}/`,
                      },
                    }
                  : {}),
              };
            });
          return query(args);
        },
      },
    },
  });
  const interrupted = new EagleLibraryTransferService(
    legacyDb,
    {
      copyObject: async () => {
        throw new Error('synthetic copy interruption');
      },
      headObject: (...args) => storage.headObject(...args),
    },
    'MATERIAL',
  );
  await assert.rejects(
    interrupted.send(ownerId, { operationId: retryId, assetIds: [middleId] }, false),
    /interruption/,
  );
  const frozen = await db.eagleLibraryTransfer.findUniqueOrThrow({ where: { id: retryId } });
  await db.eagleLibraryTransfer.update({
    where: { id: retryId },
    data: {
      plan: frozen.plan.map((item) => ({
        ...item,
        pyramid: { ...item.pyramid, storagePrefix: item.pyramid.storagePrefix + '/' },
      })),
    },
  });
  const inbound = await new EagleLibraryTransferService(db, storage, 'MATERIAL').send(
    ownerId,
    { operationId: retryId, assetIds: [middleId] },
    false,
  );
  const final = await db.eagleAsset.findUniqueOrThrow({
    where: { id: inbound.assets[0].assetId },
    include: { imagePyramids: true },
  });
  assert(!final.imagePyramids[0].storagePrefix.endsWith('/'));
  const opened = await new EagleMediaService(db, storage, 'PHOTO').getPyramidTile(
    ownerId,
    final.id,
    final.imagePyramids[0].id,
    0,
    0,
    0,
  );
  const chunks = [];
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), currentTile);
  const roundTripDeadline = Date.now() + 10000;
  while (await db.eagleObjectDeletion.count({ where: { ownerId } })) {
    if (Date.now() > roundTripDeadline || worker.exitCode !== null)
      throw new Error('Roundtrip cleanup did not drain');
    await delay(50);
  }
  const middleKeys = [
    middle.originalObjectKey,
    ...middle.renditions.map((r) => r.storageKey),
    `${middle.imagePyramids[0].storagePrefix}/0/0_0.webp`,
  ];
  for (const key of [...initialKeys, ...middleKeys])
    await assert.rejects(
      storage.headObject(key),
      (error) => error.$metadata?.httpStatusCode === 404,
    );
  assert.equal(
    (await storage.headObject(`${final.imagePyramids[0].storagePrefix}/0/0_0.webp`)).ContentLength,
    currentTile.length,
  );
  console.log(
    JSON.stringify({
      test: 'real-local-storage',
      sent: result.completed,
      checkedObjects: 32,
      newSendStorageHeads: heads,
      sourcePurgePreservedTargetBytes: true,
      roundTripTileReadable: true,
      legacyFrozenPlanResumed: true,
      retiredRoundTripObjectsAbsent: new Set([...initialKeys, ...middleKeys]).size,
      lateWriterCannotOverwriteTarget: true,
      orphanAttemptReclaimed: true,
      peakCopies: peak,
      sendMilliseconds,
      cleanedReceipts: cleanupKeys.length,
      delayedReceipts: 1,
      purgedMaterialAssets: targets.length,
      cleanupMilliseconds,
      milliseconds: performance.now() - start,
    }),
  );
} finally {
  if (worker && worker.exitCode === null) {
    const exited = once(worker, 'exit');
    worker.kill('SIGTERM');
    await exited;
  }
  storage.onModuleDestroy();
  s3.destroy();
  await db.$disconnect();
}
