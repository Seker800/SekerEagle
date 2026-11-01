import type { LibraryMemoryIndex } from '../eagle/eagle-memory-index';
import type { MemoryAsset } from '../eagle/eagle-memory-predicate';

/** COUNT(DISTINCT asset.id) over the same current/visible face membership as the original SQL. */
export function residentPersonCounts(
  index: LibraryMemoryIndex,
  includePrivate: boolean,
): Array<{ id: string; photos: number }> {
  if (index.libraryMode !== 'PHOTO') throw new Error('Unsupported people library');
  return index.derive(
    `people-counts:${includePrivate ? 'private' : 'public'}`,
    ['photoFaces', 'mediaRevision', 'deletedAt', 'isPrivate'],
    () => {
      const counts = new Map<string, number>();
      index.forEach({ deletedAt: null, ...(includePrivate ? {} : { isPrivate: false }) }, (row) => {
        const people = new Set(
          (row.photoFaces as MemoryAsset[])
            .filter(
              (face) =>
                face.isCurrent &&
                face.assetRevision === row.mediaRevision &&
                typeof face.personId === 'string',
            )
            .map((face) => face.personId as string),
        );
        for (const id of people) counts.set(id, (counts.get(id) ?? 0) + 1);
      });
      return [...counts].map(([id, photos]) => ({ id, photos }));
    },
  );
}
