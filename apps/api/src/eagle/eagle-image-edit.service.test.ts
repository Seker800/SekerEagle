import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createImageEdit } from '@sekereagle/library-core';
import { EagleImageEditService } from './eagle-image-edit.service';
import { SaveImageEditDto } from './eagle-image-edit.dto';
import { validate } from 'class-validator';

const input = {
  operationId: 'c94ad60d-c13b-4e22-b44c-221b1936271a',
  rowVersion: 3,
  edit: createImageEdit(),
};
test('missing, cross-owner, cross-library, private and trashed sources fail before storage', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    let where: unknown;
    const prisma = {
      eagleAsset: {
        findFirst: async (query: { where: unknown }) => {
          where = query.where;
          return null;
        },
      },
    };
    await assert.rejects(
      () =>
        new EagleImageEditService(prisma as never, {} as never, mode).save(
          'owner',
          'foreign',
          input,
          false,
        ),
      NotFoundException,
    );
    assert.deepEqual(where, {
      id: 'foreign',
      ownerId: 'owner',
      libraryMode: mode,
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    });
  }
});
test('rejects stale revisions, videos and unsupported formats before storage', async () => {
  for (const [source, exception] of [
    [{ rowVersion: 2, mimeType: 'image/png' }, ConflictException],
    [{ rowVersion: 3, mimeType: 'video/mp4' }, BadRequestException],
    [{ rowVersion: 3, mimeType: 'image/gif' }, BadRequestException],
  ] as const) {
    const db = { eagleAsset: { findFirst: async () => source } };
    await assert.rejects(
      () =>
        new EagleImageEditService(db as never, {} as never).save('owner', 'asset', input, false),
      exception,
    );
  }
});
test('invalid recipe cannot create an operation or read storage', async () => {
  await assert.rejects(
    () =>
      new EagleImageEditService({} as never, {} as never).save(
        'owner',
        'asset',
        { ...input, edit: { ...input.edit, brightness: NaN } },
        false,
      ),
    BadRequestException,
  );
});

test('edit DTO forbids owner, mode and object-key injection and malformed declarations', async () => {
  assert.equal(
    (
      await validate(Object.assign(new SaveImageEditDto(), input), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).length,
    0,
  );
  const invalid = Object.assign(new SaveImageEditDto(), input, {
    ownerId: 'other',
    libraryMode: 'PHOTO',
    targetKey: 'foreign',
    rowVersion: 0,
    operationId: 'invalid',
  });
  const errors = await validate(invalid, { whitelist: true, forbidNonWhitelisted: true });
  assert.deepEqual(errors.map((error) => error.property).sort(), [
    'libraryMode',
    'operationId',
    'ownerId',
    'rowVersion',
    'targetKey',
  ]);
});
