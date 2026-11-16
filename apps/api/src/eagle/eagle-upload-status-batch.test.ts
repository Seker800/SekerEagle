import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { PhotoUploadsController } from '../photos/photo-library.module';
import { UploadStatusBatchDto } from './eagle-upload.dto';
import { EagleUploadService } from './eagle-upload.service';
import { EagleUploadController } from './eagle-upload.controller';

const sessionId = '11111111-1111-4111-8111-111111111111';
const otherSessionId = '22222222-2222-4222-8222-222222222222';

test('batch status is scoped to the authenticated owner, library mode and requested ids', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    let query: unknown;
    const service = new EagleUploadService(
      {
        uploadSession: {
          findMany: async (input: unknown) => {
            query = input;
            return [
              {
                id: sessionId,
                status: 'ASSEMBLED',
                eagleAssetId: null,
                objectCleanupPending: false,
                finalizationAttempts: 0,
                lastError: null,
              },
            ];
          },
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      mode,
    );
    const result = await service.getSessions('authenticated-owner', [sessionId, sessionId]);
    assert.deepEqual(query, {
      where: {
        id: { in: [sessionId] },
        uploaderId: 'authenticated-owner',
        libraryMode: mode,
      },
      select: {
        id: true,
        status: true,
        eagleAssetId: true,
        objectCleanupPending: true,
        finalizationAttempts: true,
        lastError: true,
      },
    });
    assert.equal(result.items.length, 1);
  }
});

test('foreign or unknown sessions are absent without disclosing existence', async () => {
  const service = new EagleUploadService(
    {
      uploadSession: {
        findMany: async () => [],
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    'MATERIAL',
  );
  assert.deepEqual(await service.getSessions('owner', [otherSessionId]), { items: [] });
});

test('batch status takes identity from authentication and never accepts ownerId', async () => {
  const calls: unknown[] = [];
  const controller = new EagleUploadController(
    {
      getSessions: async (...args: unknown[]) => {
        calls.push(args);
        return { items: [] };
      },
    } as never,
    {} as never,
  );
  await controller.getStatusBatch({ sub: 'owner' } as never, {
    uploadSessionIds: [sessionId],
  });
  assert.deepEqual(calls, [['owner', [sessionId]]]);
});

test('status DTO rejects empty, malformed and injected payloads', async () => {
  for (const input of [
    { uploadSessionIds: [] },
    { uploadSessionIds: ['not-a-uuid'] },
    { uploadSessionIds: [sessionId], ownerId: 'foreign' },
    {},
  ]) {
    assert.ok(
      (
        await validate(plainToInstance(UploadStatusBatchDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
    );
  }
  assert.equal(
    (await validate(plainToInstance(UploadStatusBatchDto, { uploadSessionIds: [sessionId] })))
      .length,
    0,
  );
});

test('batch status keeps same-origin protection in both library modes', () => {
  for (const controller of [EagleUploadController, PhotoUploadsController]) {
    const handler = Reflect.get(controller.prototype, 'getStatusBatch') as object;
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOrPatOriginGuard]);
  }
});
