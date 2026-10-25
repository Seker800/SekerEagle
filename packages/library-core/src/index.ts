export const LIBRARY_MODES = ['MATERIAL', 'PHOTO'] as const;
export type LibraryMode = (typeof LIBRARY_MODES)[number];

export interface LibraryScope {
  readonly ownerId: string;
  readonly libraryMode: LibraryMode;
}

export function parseLibraryMode(value: unknown): LibraryMode {
  if (value === undefined) return 'MATERIAL';
  if (value === 'MATERIAL' || value === 'PHOTO') return value;
  throw new Error('Invalid library mode');
}

export function createLibraryScope(
  ownerId: string,
  libraryMode: LibraryMode = 'MATERIAL',
): LibraryScope {
  if (!ownerId.trim()) throw new Error('Library owner is required');
  return Object.freeze({ ownerId, libraryMode: parseLibraryMode(libraryMode) });
}

export function libraryScopeKey(scope: LibraryScope): string {
  return JSON.stringify([scope.ownerId, scope.libraryMode]);
}

export function sameLibraryScope(left: LibraryScope, right: LibraryScope): boolean {
  return left.ownerId === right.ownerId && left.libraryMode === right.libraryMode;
}

export { suggestPhotoGroups } from './photo-grouping';
export * from './media-formats';

export * from './photo-edit-recipe';
export * from './photo-edit-advanced';
export * from './photo-capture-metadata';
export * from './task-scheduling';
export * from './photo-statistics-lens';
export * from './asset-operations';
