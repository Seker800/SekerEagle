import { describe, expect, it } from 'vitest';
import { createEagleQueryKeys } from './eagle-query-keys';

describe('createEagleQueryKeys', () => {
  it('isolates every Eagle cache namespace by owner', () => {
    const ownerA = createEagleQueryKeys('owner-a');
    const ownerB = createEagleQueryKeys('owner-b');

    expect(ownerA.assets).toEqual(['eagle', 'owner-a', 'assets']);
    expect(ownerA.assetDetail('asset-1')).toEqual(['eagle', 'owner-a', 'asset-detail', 'asset-1']);
    expect(ownerA.assetList('ACTIVE', { rating: 5 })).not.toEqual(
      ownerB.assetList('ACTIVE', { rating: 5 }),
    );
  });
});

