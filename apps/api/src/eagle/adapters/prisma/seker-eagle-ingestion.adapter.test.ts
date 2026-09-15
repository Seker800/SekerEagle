import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaSekerEagleIngestionAdapter } from './seker-eagle-ingestion.adapter';

test('imported manual tags recompute the asset private projection in the metadata transaction', async () => {
  const assetWrites: unknown[] = [];
  const transaction = {
    eagleAssetManualTagIngestion: {
      findMany: async () => [],
      createMany: async () => ({ count: 1 }),
    },
    eagleManualTag: {
      findMany: async () => [{ id: 'tag-private', normalizedName: 'private' }],
    },
    eagleAsset: {
      update: async () => ({}),
      updateMany: async (input: unknown) => {
        assetWrites.push(input);
        return { count: 1 };
      },
    },
    eagleAssetAnnotation: { updateMany: async () => ({ count: 0 }) },
    eagleAssetManualTag: { createMany: async () => ({ count: 1 }) },
  };
  const adapter = new PrismaSekerEagleIngestionAdapter();

  await adapter.applyMetadata(
    {
      sourceKey: 'eagle-app:item-1',
      ownerId: 'owner-a',
      assetId: 'asset-a',
      displayName: 'Private reference',
      rating: null,
      libraryAddedAt: null,
      description: null,
      sourceUrl: null,
      tags: [
        {
          name: 'Private',
          normalizedName: 'private',
          color: null,
          isStarred: false,
          groups: [],
        },
      ],
    },
    transaction as never,
  );

  assert.equal(assetWrites.length, 2);
  assert.match(JSON.stringify(assetWrites), /marksAssetsPrivate/);
  assert.match(JSON.stringify(assetWrites), /asset-a/);
});
