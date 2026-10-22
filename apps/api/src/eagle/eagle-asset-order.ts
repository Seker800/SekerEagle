import type { LibraryMode } from '@prisma/client';

export type EagleAssetSort = 'CAPTURED_AT' | 'ADDED_AT';

export function defaultAssetSort(mode: LibraryMode): EagleAssetSort {
  return mode === 'PHOTO' ? 'CAPTURED_AT' : 'ADDED_AT';
}

export function assetDateField(mode: LibraryMode, sort = defaultAssetSort(mode)) {
  return sort === 'CAPTURED_AT' ? 'chronologicalAt' : 'libraryAddedAt';
}
