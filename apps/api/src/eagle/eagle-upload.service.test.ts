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
  const service = new EagleUploadService(prisma as never, storage as never, {} as never);

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
  const service = new EagleUploadService(prisma as never, {} as never, {} as never);

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
  const service = new EagleUploadService(prisma as never, storage as never, {} as never);

  await assert.rejects(
    service.complete(ownerId, sessionId, { parts: [{ partNumber: 1, etag: 'etag-1' }] }),
    /database unavailable/,
  );

  assert.equal(updates.some((data) => data.status === 'ASSEMBLED'), true);
  assert.deepEqual(updates.at(-1), {
    status: 'FAILED',
    finalizationAttempts: { increment: 1 },
    lastError: 'database unavailable',
    objectCleanupPending: false,
  });
});
