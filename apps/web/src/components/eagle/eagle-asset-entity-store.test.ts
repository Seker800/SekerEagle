import { describe, expect, it, vi } from 'vitest';
import { getEagleAssetEntityStore, retainEagleAssetEntityStore } from './eagle-asset-entity-store';

describe('owner-scoped Eagle asset entity stores', () => {
  it('keeps a shared store until its last mounted consumer releases it', () => {
    const ownerId = crypto.randomUUID();
    const store = getEagleAssetEntityStore(ownerId);
    const releaseFirst = retainEagleAssetEntityStore(ownerId, store);
    const releaseSecond = retainEagleAssetEntityStore(ownerId, store);

    releaseFirst();
    expect(getEagleAssetEntityStore(ownerId)).toBe(store);

    releaseSecond();
    expect(getEagleAssetEntityStore(ownerId)).not.toBe(store);
  });

  it('evicts every dependent page cache only after the final consumer leaves', () => {
    const scope = crypto.randomUUID();
    const store = getEagleAssetEntityStore(scope);
    const firstCache = vi.fn();
    const secondCache = vi.fn();
    const releaseFirst = retainEagleAssetEntityStore(scope, store, firstCache);
    const releaseSecond = retainEagleAssetEntityStore(scope, store, secondCache);
    releaseFirst();
    expect(firstCache).not.toHaveBeenCalled();
    expect(secondCache).not.toHaveBeenCalled();
    releaseSecond();
    releaseSecond();
    expect(firstCache).toHaveBeenCalledTimes(1);
    expect(secondCache).toHaveBeenCalledTimes(1);
  });

  it('makes release idempotent', () => {
    const ownerId = crypto.randomUUID();
    const store = getEagleAssetEntityStore(ownerId);
    const release = retainEagleAssetEntityStore(ownerId, store);

    release();
    release();

    expect(getEagleAssetEntityStore(ownerId)).not.toBe(store);
  });
});

it('replaces the media revision together with its renditions after original replacement', () => {
  const store = getEagleAssetEntityStore(crypto.randomUUID());
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
