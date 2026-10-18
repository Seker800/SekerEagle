import type { LibraryMode } from '@prisma/client';

/** A module instance has one immutable library; no request changes shared mutable state. */
export const LIBRARY_MODE = Symbol('SEKEREAGLE_LIBRARY_MODE');

export function inLibrary<T extends object>(libraryMode: LibraryMode, fields: T) {
  return { ...fields, libraryMode };
}

export interface LibraryIdentity {
  readonly ownerId: string;
  readonly libraryMode: LibraryMode;
}
