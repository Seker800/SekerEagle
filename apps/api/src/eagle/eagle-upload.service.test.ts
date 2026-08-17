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
