import { describe, expect, it } from 'vitest';
import { createEagleQueryKeys } from './eagle-query-keys';

describe('createEagleQueryKeys', () => {
  it('isolates every Eagle cache namespace by owner', () => {
    const ownerA = createEagleQueryKeys('owner-a');
    expect(createEagleQueryKeys('owner-a', 'PHOTO').assets).not.toEqual(ownerA.assets);
    const ownerB = createEagleQueryKeys('owner-b');

    expect(ownerA.assets).toEqual(['eagle', 'owner-a', 'MATERIAL', 'assets']);
    expect(ownerA.assetDetailPrefix('asset-1')).toEqual([
      'eagle',
      'owner-a',
      'MATERIAL',
      'asset-detail',
      'asset-1',
    ]);
    expect(ownerA.assetList('ACTIVE', { rating: 5 })).not.toEqual(
      ownerB.assetList('ACTIVE', { rating: 5 }),
    );
  });
});

it('shares count and operation namespaces without conflating list pages or privacy scopes', () => {
  const keys = createEagleQueryKeys('owner', 'PHOTO') as ReturnType<typeof createEagleQueryKeys> & {
    libraryCounts: readonly unknown[];
    libraryCount: (visible: boolean, revision: number) => readonly unknown[];
    operations: readonly unknown[];
    operationList: (visible: boolean) => readonly unknown[];
  };
  expect(keys.libraryCounts).toEqual(['eagle', 'owner', 'PHOTO', 'assets', 'library-count']);
  expect(keys.libraryCount(false, 2)).toEqual([...keys.libraryCounts, false, 2]);
  expect(keys.libraryCount(false, 2)).not.toEqual(keys.libraryCount(true, 2));
  expect(keys.libraryCount(false, 2)).not.toEqual(keys.libraryCount(false, 3));
  expect(keys.operationList(false)).toEqual([...keys.operations, false]);
  expect(keys.operationList(false)).not.toEqual(keys.operationList(true));
});
