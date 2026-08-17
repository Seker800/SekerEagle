import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleMediaService } from './eagle-media.service';

test('media lookup stays owner-scoped and available in trash until purge is scheduled', async () => {
  const queries: unknown[] = [];
  const service = new EagleMediaService(
    {
      eagleAsset: {
        findFirst: async (query: unknown) => {
          queries.push(query);
          return {
            originalObjectKey: 'users/owner-a/assets/asset-1/original.jpg',
            originalName: 'original.jpg',
            mimeType: 'image/jpeg',
            byteSize: 3n,
          };
        },
      },
    } as never,
    {
      getObject: async () => ({
        Body: {},
        ContentType: 'image/jpeg',
        ContentLength: 3,
      }),
    } as never,
  );

  await service.getOriginal('owner-a', 'asset-1');

  assert.deepEqual(queries[0], {
    where: { ownerId: 'owner-a', id: 'asset-1', purgeAfter: null },
    select: {
      originalObjectKey: true,
      originalName: true,
      mimeType: true,
      byteSize: true,
    },
  });
});

test('conditional media reads preserve an object-storage not-modified response', async () => {
  const service = new EagleMediaService(
    {
      eagleAssetRendition: {
        findFirst: async () => ({
          storageKey: 'users/owner-a/assets/asset-1/renditions/1/preview.webp',
          mimeType: 'image/webp',
          kind: 'PREVIEW',
        }),
      },
    } as never,
    {
      getObject: async () => {
        throw Object.assign(new Error('not modified'), {
          name: 'NotModified',
          $metadata: { httpStatusCode: 304 },
        });
      },
    } as never,
  );

  const result = await service.getRendition('owner-a', 'asset-1', 'rendition-1', 'etag-1');

  assert.equal(result.notModified, true);
  assert.equal(result.etag, 'etag-1');
  assert.equal(result.stream, null);
});

test('pyramid descriptor is owner-scoped and only exposes the current ready revision', async () => {
  const queries: unknown[] = [];
  const service = new EagleMediaService(
    {
      eagleAsset: {
        findFirst: async (query: unknown) => {
          queries.push(query);
          return {
            mediaRevision: 4,
            imagePyramids: [
              {
                id: 'pyramid-1',
                revision: 4,
                width: 8_000,
                height: 6_000,
                tileSize: 512,
                overlap: 1,
                format: 'webp',
                maxLevel: 13,
              },
            ],
          };
        },
      },
    } as never,
    {} as never,
  );

  assert.deepEqual(await service.getPyramidDescriptor('owner-a', 'asset-1'), {
    id: 'pyramid-1',
    width: 8_000,
    height: 6_000,
    tileSize: 512,
    overlap: 1,
    format: 'webp',
    maxLevel: 13,
    tileUrlTemplate:
      '/api/eagle/assets/asset-1/pyramids/pyramid-1/tiles/{level}/{x}/{y}',
  });
  assert.deepEqual(queries[0], {
    where: { ownerId: 'owner-a', id: 'asset-1', purgeAfter: null },
    select: {
      mediaRevision: true,
      imagePyramids: {
        where: { status: 'READY' },
        orderBy: { revision: 'desc' },
        select: {
          id: true,
          revision: true,
          width: true,
          height: true,
          tileSize: true,
          overlap: true,
          format: true,
          maxLevel: true,
        },
      },
    },
  });
});

test('pyramid tiles validate coordinates and remain owner-scoped', async () => {
  const objectKeys: string[] = [];
  const service = new EagleMediaService(
    {
      eagleImagePyramid: {
        findFirst: async () => ({
          storagePrefix: 'users/owner-a/assets/asset-1/pyramids/4/pyramid-v1',
          width: 8_000,
          height: 6_000,
          tileSize: 512,
          maxLevel: 13,
          format: 'webp',
        }),
      },
    } as never,
    {
      getObject: async (key: string) => {
        objectKeys.push(key);
        return { Body: {}, ContentType: 'image/webp', ContentLength: 10 };
      },
    } as never,
  );

  await service.getPyramidTile('owner-a', 'asset-1', 'pyramid-1', 13, 15, 11);
  assert.deepEqual(objectKeys, [
    'users/owner-a/assets/asset-1/pyramids/4/pyramid-v1/13/15_11.webp',
  ]);
  await assert.rejects(
    service.getPyramidTile('owner-a', 'asset-1', 'pyramid-1', 13, 16, 0),
    /切片不存在/,
  );
});
