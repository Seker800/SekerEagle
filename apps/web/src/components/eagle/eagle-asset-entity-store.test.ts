import { describe, expect, it, vi } from 'vitest';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { EagleAssetEntityStore } from './eagle-asset-entity-store';

function asset(id: string, displayName = id): EagleAssetListItem {
  return { id, displayName } as EagleAssetListItem;
}

describe('EagleAssetEntityStore', () => {
  it('stores one canonical entity when filtered pages repeat an asset', () => {
    const store = new EagleAssetEntityStore();
    store.upsertMany([asset('a', 'first'), asset('b')]);
    store.upsertMany([asset('a', 'newest')]);

    expect(store.size).toBe(2);
    expect(store.getMany(['a', 'b']).map(({ displayName }) => displayName)).toEqual([
      'newest',
      'b',
    ]);
  });

  it('merges processing updates without replacing stable metadata', () => {
    const listener = vi.fn();
    const store = new EagleAssetEntityStore();
    store.upsertMany([asset('a', 'kept')]);
    store.subscribe(listener);
    store.mergeProcessingUpdates([
      {
        id: 'a',
        lifecycleStatus: 'READY',
        mediaErrorCode: null,
        updatedAt: '2026-08-17T00:00:00.000Z',
        renditions: [],
      },
    ]);

    expect(store.get('a')?.displayName).toBe('kept');
    expect(store.get('a')?.lifecycleStatus).toBe('READY');
    expect(listener).toHaveBeenCalledOnce();
  });
});
