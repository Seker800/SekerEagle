import { createHash } from 'node:crypto';
import type {
  Prisma,
  LibraryMode,
  EagleAssetOperation,
  EagleAssetOperationItem,
} from '@prisma/client';
import type { DuplicateGroup, DuplicateCandidate } from '@sekereagle/library-core';
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Snapshot = { id: string; rowVersion: number; mediaRevision: number };
export type CleanupSnapshot = {
  kind: 'cleanup';
  resources: Snapshot[];
  keepers: Snapshot[];
  exact: boolean;
  targetId: string;
};
export type ScanSnapshot = { kind: 'scan'; rows: Snapshot[] } | { kind: 'build' };
export type Item = EagleAssetOperationItem & { operation: EagleAssetOperation };
export const candidateSelect = {
  id: true,
  sha256: true,
  byteSize: true,
  mediaRevision: true,
  rowVersion: true,
  isPrivate: true,
  width: true,
  height: true,
  rating: true,
  libraryAddedAt: true,
  mimeType: true,
  lifecycleStatus: true,
  duplicateFingerprint: true,
} satisfies Prisma.EagleAssetSelect;
export function signature(
  ownerId: string,
  mode: LibraryMode,
  group: DuplicateGroup,
  rows: Map<string, Pick<DuplicateCandidate, 'mediaRevision' | 'rowVersion'>>,
) {
  return digest([
    ownerId,
    mode,
    group.kind,
    group.assetIds
      .map((id) => {
        const row = rows.get(id)!;
        return [id, row.mediaRevision, row.rowVersion];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

export function inDuplicateLibrary(
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
) {
  return {
    ownerId,
    libraryMode,
    deletedAt: null,
    purgeAfter: null,
    storageTransferredOut: false,
    ...(includePrivate ? {} : { isPrivate: false }),
  };
}

/** Ignore decisions follow content, while review signatures also freeze editable metadata. */
export function dismissalSignature(
  ownerId: string,
  mode: LibraryMode,
  group: DuplicateGroup,
  rows: Map<string, Pick<Snapshot, 'mediaRevision'>>,
) {
  return digest([
    ownerId,
    mode,
    group.kind,
    group.assetIds
      .map((id) => [id, rows.get(id)!.mediaRevision] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);
}
