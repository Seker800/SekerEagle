import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InitiateEagleUploadDto } from './eagle-upload.dto';
import { EagleUploadService } from './eagle-upload.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const input = {
  originalName: 'travel-edited.png',
  mimeType: 'image/png',
  size: 12,
  duplicatePolicy: 'CREATE_COPY',
};

test('edited source authorization is checked in its owner and library before allocating storage', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    let predicate: unknown;
    const service = new EagleUploadService(
      {
        eagleAsset: {
          findFirst: async ({ where }: { where: unknown }) => {
            predicate = where;
            return null;
          },
        },
        uploadSession: { create: async () => ({ id: 'session', size: 12n }) },
      } as never,
      { createMultipartUpload: async () => 'multipart' } as never,
      { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
      {} as never,
      mode,
    );
    await assert.rejects(
      () =>
        service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', {
          ...input,
          copySourceAssetId: 'source',
          copySourceRowVersion: 2,
        } as InitiateEagleUploadDto),
      NotFoundException,
    );
    assert.deepEqual(predicate, {
      id: 'source',
      ownerId: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a',
      libraryMode: mode,
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    });
  }
});
test('stale edited-source versions cannot initiate a new copy', async () => {
  const service = new EagleUploadService(
    {
      eagleAsset: { findFirst: async () => ({ rowVersion: 3 }) },
      uploadSession: { create: async () => ({ id: 'session', size: 12n }) },
    } as never,
    { createMultipartUpload: async () => 'multipart' } as never,
    { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
    {} as never,
  );
  await assert.rejects(
    () =>
      service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', {
        ...input,
        copySourceAssetId: 'source',
        copySourceRowVersion: 2,
      } as InitiateEagleUploadDto),
    ConflictException,
  );
});
test('edited-photo upload permits explicit copies but rejects owner and replacement injection', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  assert.equal(validateSync(plainToInstance(InitiateEagleUploadDto, input), options).length, 0);
  const errors = validateSync(
    plainToInstance(InitiateEagleUploadDto, {
      ...input,
      ownerId: 'victim',
      replacementAssetId: 'original',
    }),
    options,
  );
  assert.deepEqual(errors.map((error) => error.property).sort(), ['ownerId', 'replacementAssetId']);
  assert.ok(
    validateSync(
      plainToInstance(InitiateEagleUploadDto, { ...input, duplicatePolicy: 'OVERWRITE' }),
      options,
    ).some((error) => error.property === 'duplicatePolicy'),
  );
});
test('edited-photo copies derive every ownership field from the authenticated subject', async () => {
  let written: Record<string, any> = {};
  let objectKey = '';
  const service = new EagleUploadService(
    {
      uploadSession: {
        create: async ({ data }: { data: Record<string, any> }) => {
          written = data;
          return { id: 'session', size: 12n };
        },
      },
    } as never,
    {
      createMultipartUpload: async (key: string) => {
        objectKey = key;
        return 'multipart';
      },
    } as never,
    { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
    {} as never,
  );
  await service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', input as InitiateEagleUploadDto);
  assert.equal(written.uploaderId, '5a1fd7d1-fd57-4e42-83f7-55425ca8704a');
  assert.deepEqual(written.eagleState.create.owner, {
    connect: { id: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a' },
  });
  assert.equal(written.eagleState.create.duplicatePolicy, 'CREATE_COPY');
  assert.equal(written.eagleState.create.replacementAssetId, undefined);
  assert.ok(objectKey.startsWith('users/5a1fd7d1-fd57-4e42-83f7-55425ca8704a/'));
});
test('ordinary uploads retain the previous skip-duplicate behavior', async () => {
  let policy: unknown;
  const service = new EagleUploadService(
    {
      uploadSession: {
        create: async ({
          data,
        }: {
          data: { eagleState: { create: { duplicatePolicy: unknown } } };
        }) => {
          policy = data.eagleState.create.duplicatePolicy;
          return { id: 'session', size: 12n };
        },
      },
    } as never,
    { createMultipartUpload: async () => 'multipart' } as never,
    { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
    {} as never,
  );
  await service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', {
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
  });
  assert.equal(policy, 'SKIP');
});

test('edited source IDs and versions form a validated declaration without client privacy flags', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  for (const invalid of [
    { copySourceAssetId: 'bad', copySourceRowVersion: 1 },
    { copySourceAssetId: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a' },
    { copySourceRowVersion: 1 },
    { copySourceAssetId: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a', copySourceRowVersion: 0 },
    { isPrivate: true },
  ]) {
    assert.ok(
      validateSync(plainToInstance(InitiateEagleUploadDto, { ...input, ...invalid }), options)
        .length,
    );
  }
});
