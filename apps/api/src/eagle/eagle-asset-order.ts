import type { LibraryMode } from '@prisma/client';

export type EagleAssetSort = 'CAPTURED_AT' | 'ADDED_AT';
export type EagleAssetOrder = EagleAssetSort | 'DELETED_AT';

export function defaultAssetSort(mode: LibraryMode): EagleAssetSort {
  return mode === 'PHOTO' ? 'CAPTURED_AT' : 'ADDED_AT';
}

export function assetDateField(
  mode: LibraryMode,
  sort?: EagleAssetSort,
): 'chronologicalAt' | 'libraryAddedAt';
export function assetDateField(mode: LibraryMode, sort: 'DELETED_AT'): 'deletedAt';
export function assetDateField(
  mode: LibraryMode,
  sort: EagleAssetOrder | undefined,
): 'chronologicalAt' | 'libraryAddedAt' | 'deletedAt';
export function assetDateField(
  mode: LibraryMode,
  sort?: EagleAssetOrder,
): 'chronologicalAt' | 'libraryAddedAt' | 'deletedAt' {
  if (sort === 'DELETED_AT') return 'deletedAt';
  return (sort ?? defaultAssetSort(mode)) === 'CAPTURED_AT' ? 'chronologicalAt' : 'libraryAddedAt';
}
