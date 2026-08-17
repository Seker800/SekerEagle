import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EagleUploadService } from './eagle-upload.service';

const ownerId = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';
const sessionId = '13e84291-8ad7-4c44-aa76-29a45ce058b2';

test('lists uploaded multipart parts for resumable clients', async () => {
  const storage = {
    listMultipartUploadParts: async () => [
      { partNumber: 1, etag: '"first"', size: 5_242_880 },
      { partNumber: 2, etag: '"second"', size: 1024 },
    ],
  };
  const prisma = {
    uploadSession: {
      findFirst: async () => ({
        id: sessionId,
        uploaderId: ownerId,
        status: 'INITIATED',
        objectKey: `users/${ownerId}/assets/id/example.jpg`,
        multipartUploadId: 'multipart-id',
        eagleState: {},
      }),
      count: async () => 1,
    },
  };
  const service = new EagleUploadService(
    prisma as never,
    storage as never,
    {} as never,
    {} as never,
  );

  assert.deepEqual(await service.listParts(ownerId, sessionId), {
    uploadSessionId: sessionId,
    parts: [
      { partNumber: 1, etag: '"first"', size: 5_242_880 },
      { partNumber: 2, etag: '"second"', size: 1024 },
    ],
  });
});

test('multipart part listing does not reveal another owner session', async () => {
  const prisma = {
    uploadSession: {
      findFirst: async () => null,
      count: async () => 0,
    },
  };
  const service = new EagleUploadService(prisma as never, {} as never, {} as never, {} as never);

  await assert.rejects(service.listParts(ownerId, sessionId), NotFoundException);
});

test('completion preserves an assembled object for recovery when DB finalization fails', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const session = {
    id: sessionId,
    uploaderId: ownerId,
    status: 'INITIATED',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 5n,
    objectKey: `users/${ownerId}/assets/id/photo.jpg`,
    multipartUploadId: 'multipart-id',
    eagleAssetId: null,
    eagleState: {},
  };
  const prisma = {
    uploadSession: {
      findFirst: async () => session,
      count: async () => 1,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { count: 1 };
      },
    },
    $transaction: async () => {
      throw new Error('database unavailable');
    },
  };
  const storage = {
    completeMultipartUpload: async () => undefined,
    headObject: async () => ({ ContentLength: 5 }),
  };
  const service = new EagleUploadService(
    prisma as never,
    storage as never,
    {} as never,
    {
      inspect: async () => ({
        sha256: 'a'.repeat(64),
        format: 'jpeg',
        width: 1,
        height: 1,
        durationMs: null,
      }),
    } as never,
  );

  await assert.rejects(
    service.complete(ownerId, sessionId, { parts: [{ partNumber: 1, etag: 'etag-1' }] }),
    /database unavailable/,
  );

  assert.equal(
    updates.some((data) => data.status === 'ASSEMBLED'),
    true,
  );
  assert.deepEqual(updates.at(-1), {
    status: 'FAILED',
    finalizationAttempts: { increment: 1 },
    lastError: 'database unavailable',
    objectCleanupPending: false,
  });
});

test('finalization skips an owner-scoped duplicate and queues uploaded object cleanup', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const session = {
    id: sessionId,
    uploaderId: ownerId,
    status: 'ASSEMBLED',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 5n,
    objectKey: `users/${ownerId}/assets/id/photo.jpg`,
    multipartUploadId: 'multipart-id',
    eagleAssetId: null,
    objectCleanupPending: false,
    completionParts: [{ PartNumber: 1, ETag: 'etag-1' }],
    eagleState: { duplicatePolicy: 'SKIP', replacementAssetId: null, expectedContentSha256: null },
  };
  const transaction = {
    uploadSession: {
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: { data: Record<string, unknown> }) => writes.push(data),
    },
    $executeRaw: async () => 1,
    eagleAsset: { findFirst: async () => ({ id: 'asset-existing' }) },
    eagleAssetProcessingJob: {
      createMany: async () => assert.fail('duplicates must not create processing jobs'),
    },
    eagleUploadSessionState: { update: async () => undefined },
  };
  const service = new EagleUploadService(
    {
      uploadSession: { findFirst: async () => session, count: async () => 1 },
      $transaction: async (callback: (value: unknown) => unknown) => callback(transaction),
    } as never,
    { headObject: async () => ({ ContentLength: 5 }) } as never,
    {} as never,
    {
      inspect: async () => ({
        sha256: 'a'.repeat(64),
        format: 'jpeg',
        width: 1,
        height: 1,
        durationMs: null,
      }),
    } as never,
  );

  const result = await service.complete(ownerId, sessionId, {
    parts: [{ partNumber: 1, etag: 'etag-1' }],
  });

  assert.equal(result.assetId, 'asset-existing');
  assert.equal(result.duplicate, true);
  assert.equal(writes[0]?.objectCleanupPending, true);
});

test('content replacement preserves the logical asset id and advances its media revision', async () => {
  const assetWrites: Array<Record<string, unknown>> = [];
  const jobs: unknown[] = [];
  const stateWrites: Array<Record<string, unknown>> = [];
  const session = {
    id: sessionId,
    uploaderId: ownerId,
    status: 'ASSEMBLED',
    originalName: 'updated.jpg',
    mimeType: 'image/jpeg',
    size: 5n,
    objectKey: `users/${ownerId}/assets/new/original.jpg`,
    multipartUploadId: 'multipart-id',
    eagleAssetId: null,
    objectCleanupPending: false,
    completionParts: [{ PartNumber: 1, ETag: 'etag-1' }],
    eagleState: {
      duplicatePolicy: 'CREATE_COPY',
      replacementAssetId: 'asset-existing',
      expectedContentSha256: 'a'.repeat(64),
    },
  };
  const transaction = {
    uploadSession: { updateMany: async () => ({ count: 1 }), update: async () => undefined },
    eagleAsset: {
      findFirst: async () => ({
        id: 'asset-existing',
        mediaRevision: 3,
        originalObjectKey: `users/${ownerId}/assets/old/original.jpg`,
        renditions: [{ storageKey: `users/${ownerId}/assets/old/preview.webp`, revision: 3 }],
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => assetWrites.push(data),
    },
    eagleAssetRendition: { deleteMany: async () => ({ count: 1 }) },
    eagleAssetProcessingJob: { createMany: async ({ data }: { data: unknown }) => jobs.push(data) },
    eagleUploadSessionState: {
      update: async ({ data }: { data: Record<string, unknown> }) => stateWrites.push(data),
    },
  };
  const service = new EagleUploadService(
    {
      uploadSession: { findFirst: async () => session, count: async () => 1 },
      $transaction: async (callback: (value: unknown) => unknown) => callback(transaction),
    } as never,
    { headObject: async () => ({ ContentLength: 5 }) } as never,
    {} as never,
    {
      inspect: async () => ({
        sha256: 'a'.repeat(64),
        format: 'jpeg',
        width: 10,
        height: 20,
        durationMs: null,
      }),
    } as never,
  );

  const result = await service.complete(ownerId, sessionId, {
    parts: [{ partNumber: 1, etag: 'etag-1' }],
  });

  assert.equal(result.assetId, 'asset-existing');
  assert.equal(assetWrites[0]?.mediaRevision, 4);
  assert.equal((jobs[0] as Array<{ assetRevision: number }>)[0]?.assetRevision, 4);
  assert.deepEqual(stateWrites[0]?.retiredObjectKeys, [
    `users/${ownerId}/assets/old/original.jpg`,
    `users/${ownerId}/assets/old/preview.webp`,
  ]);
});
