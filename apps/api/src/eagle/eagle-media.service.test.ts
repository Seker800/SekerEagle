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
