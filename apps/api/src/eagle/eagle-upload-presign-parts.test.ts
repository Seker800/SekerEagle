import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { PhotoUploadsController } from '../photos/photo-library.module';
import { PresignUploadPartsDto } from './eagle-upload.dto';
import { EagleUploadService } from './eagle-upload.service';
import { EagleUploadController } from './eagle-upload.controller';

const sessionId = '11111111-1111-4111-8111-111111111111';
const otherSessionId = '22222222-2222-4222-8222-222222222222';

test('batch presign reads the session once and signs every requested part', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    const queries: unknown[] = [];
    const signed: string[] = [];
    const service = new EagleUploadService(
      {
        uploadSession: {
          findFirst: async (input: unknown) => {
            queries.push(input);
            return { id: sessionId, objectKey: 'owner/object.jpg', multipartUploadId: 'upload-1' };
          },
        },
      } as never,
      {
        presignUploadPart: async (key: string, uploadId: string, partNumber: number) => {
          signed.push(`${key}:${uploadId}:${partNumber}`);
          return `url-${partNumber}`;
        },
      } as never,
      {} as never,
      {} as never,
      mode,
    );
    const result = await service.presignParts('authenticated-owner', sessionId, [3, 1, 3]);
    assert.deepEqual(queries, [
      {
        where: {
          id: sessionId,
          uploaderId: 'authenticated-owner',
          status: 'INITIATED',
          libraryMode: mode,
        },
        include: { eagleState: true },
      },
    ]);
    assert.deepEqual(signed, ['owner/object.jpg:upload-1:1', 'owner/object.jpg:upload-1:3']);
    assert.deepEqual(result.parts, [
      { partNumber: 1, uploadUrl: 'url-1', expiresInSeconds: 900 },
      { partNumber: 3, uploadUrl: 'url-3', expiresInSeconds: 900 },
    ]);
  }
});

test('invalid part numbers are rejected before any storage signing', async () => {
  const signed: number[] = [];
  const service = new EagleUploadService(
    {
      uploadSession: {
        findFirst: async () => {
          throw new Error('session must not be read for invalid input');
        },
      },
    } as never,
    {
      presignUploadPart: async (_key: string, _uploadId: string, partNumber: number) => {
        signed.push(partNumber);
        return 'url';
      },
    } as never,
    {} as never,
    {} as never,
    'MATERIAL',
  );
  for (const input of [[], [0], [10001], [1.5], [Number.NaN]]) {
    await assert.rejects(
      service.presignParts('owner', sessionId, input),
      (error: unknown) => error instanceof BadRequestException,
    );
  }
  assert.deepEqual(signed, []);
});

test('foreign or unknown sessions are absent without disclosing existence', async () => {
  const service = new EagleUploadService(
    {
      uploadSession: {
        findFirst: async () => null,
        count: async () => 0,
      },
    } as never,
    { presignUploadPart: async () => 'url' } as never,
    {} as never,
    {} as never,
    'MATERIAL',
  );
  await assert.rejects(
    service.presignParts('owner', otherSessionId, [1]),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test('batch presign takes identity from authentication and never accepts ownerId', async () => {
  const calls: unknown[] = [];
  const controller = new EagleUploadController(
    {
      presignParts: async (...args: unknown[]) => {
        calls.push(args);
        return { parts: [] };
      },
    } as never,
    {} as never,
  );
  await controller.presignParts({ sub: 'owner' } as never, sessionId, {
    partNumbers: [2, 1],
  } as never);
  assert.deepEqual(calls, [['owner', sessionId, [2, 1]]]);
});

test('part-number batch DTO rejects empty, out-of-range and injected payloads', async () => {
  for (const input of [
    { partNumbers: [] },
    { partNumbers: [0] },
    { partNumbers: [10001] },
    { partNumbers: ['1'] },
    { partNumbers: [1], ownerId: 'foreign' },
    {},
  ]) {
    assert.ok(
      (
        await validate(plainToInstance(PresignUploadPartsDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
    );
  }
  assert.equal(
    (await validate(plainToInstance(PresignUploadPartsDto, { partNumbers: [1, 10000] }))).length,
    0,
  );
});

test('batch presign keeps same-origin protection in both library modes', () => {
  for (const controller of [EagleUploadController, PhotoUploadsController]) {
    const handler = Reflect.get(controller.prototype, 'presignParts') as object;
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOrPatOriginGuard]);
  }
});
