import { describe, expect, it } from 'vitest';
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

  it('makes release idempotent', () => {
    const ownerId = crypto.randomUUID();
    const store = getEagleAssetEntityStore(ownerId);
    const release = retainEagleAssetEntityStore(ownerId, store);

    release();
    release();

    expect(getEagleAssetEntityStore(ownerId)).not.toBe(store);
  });
});
