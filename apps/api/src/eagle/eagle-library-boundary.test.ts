import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EagleService } from './eagle.service';
import { EagleMediaService } from './eagle-media.service';
import { EagleUploadService } from './eagle-upload.service';

const ownerId = '11111111-1111-4111-8111-111111111111';

test('legacy asset queries are explicitly material scoped', async () => {
  let where: Record<string, unknown> | undefined;
  const prisma = {
    eagleAsset: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  await new EagleService(prisma as never, undefined, 'MATERIAL').listAssets(ownerId, { limit: 50 });
  assert.equal(where?.libraryMode, 'MATERIAL');
});

test('photo asset queries use the photo service scope', async () => {
  let where: Record<string, unknown> | undefined;
  const prisma = {
    eagleAsset: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  await new EagleService(prisma as never, undefined, 'PHOTO').listAssets(ownerId, { limit: 50 });
  assert.equal(where?.libraryMode, 'PHOTO');
});

test('old media route cannot fetch a photo even when owner matches', async () => {
  let reads = 0;
  const prisma = {
    eagleAsset: {
      findFirst: async (args: any) =>
        args.where.libraryMode === 'MATERIAL' ? null : { originalObjectKey: 'photo' },
    },
  };
  const storage = {
    getObject: async () => {
      reads++;
      throw new Error('must not read');
    },
  };
  await assert.rejects(
    () =>
      new EagleMediaService(prisma as never, storage as never, 'MATERIAL').getOriginal(
        ownerId,
        'photo-id',
      ),
    NotFoundException,
  );
  assert.equal(reads, 0);
});

test('photo media lookup rejects a material resource before storage is opened', async () => {
  const prisma = {
    eagleAsset: {
      findFirst: async (args: any) =>
        args.where.libraryMode === 'PHOTO' ? null : { originalObjectKey: 'material' },
    },
  };
  await assert.rejects(
    () =>
      new EagleMediaService(prisma as never, {} as never, 'PHOTO').getOriginal(
        ownerId,
        'material-id',
      ),
    NotFoundException,
  );
});

test('upload creation freezes the target library on the session', async () => {
  let data: Record<string, unknown> | undefined;
  const prisma = {
    uploadSession: {
      create: async (args: any) => {
        data = args.data;
        return { id: 'session', size: 1n };
      },
    },
  };
  const storage = {
    createMultipartUpload: async () => 'multipart',
    abortMultipartUpload: async () => {},
  };
  const capabilities = { assertUploadAllowed: () => ({ mimeType: 'image/jpeg' }) };
  await new EagleUploadService(
    prisma as never,
    storage as never,
    capabilities as never,
    {} as never,
    'PHOTO',
  ).initiate(ownerId, { originalName: 'photo.jpg', mimeType: 'image/jpeg', size: 1 });
  assert.equal(data?.libraryMode, 'PHOTO');
});

test('material counts reject photo rules before database access', async () => {
  const service = new EagleService({} as never, undefined, 'MATERIAL');
  const query = {
    version: 2,
    conditions: [
      {
        id: 'photo',
        match: 'ALL',
        result: 'MATCH',
        rules: [{ id: 'gps', field: 'GPS', operator: 'EQUALS', value: 'WITH' }],
      },
    ],
  };
  await assert.rejects(() => service.countAssets(ownerId, query), /摄影/);
});
