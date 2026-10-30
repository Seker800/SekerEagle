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

const entity = (
  id: string,
  rowVersion: number,
  mediaRevision = rowVersion,
  date = '2026-10-30T00:00:00Z',
) =>
  ({
    id,
    rowVersion,
    mediaRevision,
    displayName: `name-${rowVersion}`,
    updatedAt: date,
    lifecycleStatus: 'READY',
    renditions: [],
    manualTags: [],
  }) as import('../../lib/eagle-api').EagleAssetListItem;
it('rejects stale metadata and media independently across list and processing responses', () => {
  const store = new EagleAssetEntityStore();
  store.upsertMany([entity('a', 2, 2)]);
  store.upsertMany([entity('a', 1, 1, '2026-10-31T00:00:00Z')]);
  expect(store.get('a')).toMatchObject({ rowVersion: 2, mediaRevision: 2, displayName: 'name-2' });
  store.mergeProcessingUpdates([
    {
      id: 'a',
      mediaRevision: 1,
      lifecycleStatus: 'FAILED',
      mediaErrorCode: 'old',
      updatedAt: '2026-11-01T00:00:00Z',
      renditions: [],
    },
  ]);
  expect(store.get('a')).toMatchObject({ mediaRevision: 2, lifecycleStatus: 'READY' });
  store.upsertMany([entity('a', 3, 1)]);
  expect(store.get('a')).toMatchObject({ rowVersion: 3, mediaRevision: 2, displayName: 'name-3' });
  store.upsertMany([entity('a', 2, 3)]);
  expect(store.get('a')).toMatchObject({ rowVersion: 3, mediaRevision: 3, displayName: 'name-3' });
});
