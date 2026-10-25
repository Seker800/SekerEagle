import { expect, it } from 'vitest';
import { EagleAssetEntityStore } from './eagle-asset-entity-store';

it('replaces the media revision together with its renditions after original replacement', () => {
  const store = new EagleAssetEntityStore();
  store.upsertMany([
    {
      id: 'asset-1',
      mediaRevision: 1,
      renditions: [],
      originalName: 'test.jpg',
      displayName: 'test',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      width: 1,
      height: 1,
      durationMs: null,
      lifecycleStatus: 'PROCESSING',
      mediaErrorCode: null,
      rowVersion: 1,
      rating: null,
      libraryAddedAt: '2026-10-19T00:00:00Z',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      deletedAt: null,
      manualTags: [],
    },
  ]);
  store.mergeProcessingUpdates([
    {
      id: 'asset-1',
      mediaRevision: 2,
      lifecycleStatus: 'READY',
      mediaErrorCode: null,
      updatedAt: '2026-10-19T00:00:00Z',
      renditions: [
        {
          id: 'preview-2',
          variant: 'default',
          kind: 'PREVIEW',
          revision: 2,
          mimeType: 'image/webp',
          byteSize: 1,
          width: 1,
          height: 1,
        },
      ],
    },
  ]);
  expect(store.get('asset-1')?.mediaRevision).toBe(2);
  expect(store.get('asset-1')?.renditions[0].revision).toBe(2);
});
