import { makeEagleAsset } from '../../test/eagle-fixtures';
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
  makeEagleAsset({
    id,
    rowVersion,
    mediaRevision,
    displayName: `name-${rowVersion}`,
    updatedAt: date,
  });
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

it('does not let a newer metadata clock suppress valid processing facts or let an older same-version list undo them', () => {
  const store = new EagleAssetEntityStore();
  store.upsertMany([{ ...entity('a', 1, 2), lifecycleStatus: 'PROCESSING' }]);
  store.upsertMany([entity('a', 2, 1, '2026-11-02T00:00:00Z')]);
  store.mergeProcessingUpdates([
    {
      id: 'a',
      mediaRevision: 2,
      lifecycleStatus: 'READY',
      mediaErrorCode: null,
      updatedAt: '2026-11-01T00:00:00Z',
      renditions: [],
    },
  ]);
  expect(store.get('a')).toMatchObject({
    rowVersion: 2,
    mediaRevision: 2,
    lifecycleStatus: 'READY',
    updatedAt: '2026-11-02T00:00:00Z',
  });
  store.upsertMany([{ ...entity('a', 2, 2), lifecycleStatus: 'PROCESSING', displayName: 'stale' }]);
  expect(store.get('a')).toMatchObject({ displayName: 'name-2', lifecycleStatus: 'READY' });
});

it('publishes only accepted facts and keeps same-time ready rendition sets monotonic', () => {
  const store = new EagleAssetEntityStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });
  expect(store.getSnapshot()).toBe(0);
  store.upsertMany([]);
  store.clear();
  const rendition = {
    id: 'r1',
    variant: 'default',
    kind: 'THUMBNAIL' as const,
    revision: 1,
    mimeType: 'image/webp',
    byteSize: 1,
    width: 1,
    height: 1,
  };
  store.upsertMany([{ ...entity('a', 2, 1), renditions: [rendition] }]);
  store.upsertMany([{ ...entity('a', 2, 1), renditions: [rendition, { ...rendition, id: 'r2' }] }]);
  expect(store.getMany(['missing', 'a'])).toHaveLength(1);
  expect(store.get('a')?.renditions).toHaveLength(2);
  const version = store.getSnapshot();
  store.upsertMany([{ ...entity('a', 1, 1, '2026-10-29T00:00:00Z'), renditions: [] }]);
  expect(store.getSnapshot()).toBe(version);
  store.mergeProcessingUpdates([
    {
      id: 'missing',
      mediaRevision: 1,
      lifecycleStatus: 'READY',
      mediaErrorCode: null,
      updatedAt: '2026-10-30T00:00:00Z',
      renditions: [],
    },
  ]);
  store.retainOnly(new Set(['a']));
  expect(store.getSnapshot()).toBe(version);
  expect(notifications).toBe(2);
  unsubscribe();
  store.clear();
  expect(notifications).toBe(2);
});

it('accepts equal-time completion but rejects a late equal-time processing state', () => {
  const store = new EagleAssetEntityStore();
  store.upsertMany([{ ...entity('a', 1, 1), lifecycleStatus: 'PROCESSING' }]);
  const update = {
    id: 'a',
    mediaRevision: 1,
    lifecycleStatus: 'READY' as const,
    mediaErrorCode: null,
    updatedAt: '2026-10-30T00:00:00Z',
    renditions: [],
  };
  store.mergeProcessingUpdates([update]);
  expect(store.get('a')?.lifecycleStatus).toBe('READY');
  store.mergeProcessingUpdates([{ ...update, lifecycleStatus: 'PROCESSING' }]);
  expect(store.get('a')?.lifecycleStatus).toBe('READY');
});
