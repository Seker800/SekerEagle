import { smartFolderMatchWhere } from '@sekereagle/library-persistence';
import type { LibraryMemoryIndex } from './eagle-memory-index';
import { memoryDateTime } from './eagle-memory-index';
import type { MemorySearchContext } from './eagle-memory-predicate';
import type { AssetSearchWhere } from './eagle-search-predicate';
import type { ImageSearchPosition } from './eagle-image-search.service';
import { assetDateField } from './eagle-asset-order';

export interface SemanticReadGraph {
  context: MemorySearchContext;
  scores: ReadonlyMap<string, ReadonlyMap<number, number>>;
}
export interface ResidentSemanticGraph extends SemanticReadGraph {
  residentBytes: number;
}
export interface ResidentSmartFolderOptions {
  where: AssetSearchWhere;
  folderIds: string[];
  limit: number;
  ordinaryMembersPossible: boolean;
  includePrivate: boolean;
  trash: boolean;
  after?: ImageSearchPosition;
}
/** Same two tiers and tie breakers as readSmartFolderPage; scores are persisted model results. */
export function residentSmartFolderPage(
  index: LibraryMemoryIndex,
  graph: SemanticReadGraph,
  options: ResidentSmartFolderOptions,
): ImageSearchPosition[] {
  const { where, folderIds, limit, after, ordinaryMembersPossible, includePrivate, trash } =
    options;
  const scope = { ownerId: index.ownerId, libraryMode: index.libraryMode as 'PHOTO' | 'MATERIAL' };
  const visible: AssetSearchWhere = {
    AND: [
      where,
      ...(includePrivate ? [] : [{ isPrivate: false }]),
      trash ? { deletedAt: { not: null }, purgeAfter: null } : { deletedAt: null },
    ],
  };
  const positions: ImageSearchPosition[] = [];
  if (after?.tier !== 0) {
    index.forEach(
      { AND: [{ id: { in: [...graph.scores.keys()] } }, visible] },
      (row) => {
        const similarity = graph.scores.get(String(row.id))?.get(Number(row.mediaRevision));
        if (
          similarity === undefined ||
          (after &&
            (similarity > after.similarity ||
              (similarity === after.similarity && String(row.id) >= after.assetId)))
        )
          return;
        positions.push({
          assetId: String(row.id),
          similarity,
          tier: 1,
          libraryAddedAt: new Date(memoryDateTime(row.libraryAddedAt)).toISOString(),
        });
      },
      graph.context,
    );
    positions.sort(
      (a, b) =>
        b.similarity - a.similarity || (a.assetId < b.assetId ? 1 : a.assetId > b.assetId ? -1 : 0),
    );
    positions.splice(limit + 1);
  }
  if (ordinaryMembersPossible && positions.length <= limit) {
    const date = assetDateField(scope.libraryMode);
    const ids = index.page(
      {
        AND: [
          visible,
          { NOT: { OR: folderIds.map((id) => smartFolderMatchWhere(scope, id)) } },
          ...(after?.tier === 0
            ? [
                {
                  OR: [
                    { [date]: { lt: new Date(after.libraryAddedAt) } },
                    { [date]: new Date(after.libraryAddedAt), id: { lt: after.assetId } },
                  ],
                },
              ]
            : []),
        ],
      },
      date,
      'desc',
      limit + 1 - positions.length,
      0,
      graph.context,
    );
    const wanted = new Set(ids);
    const dates = new Map<string, string>();
    index.forEach({ id: { in: ids } }, (row) => {
      if (wanted.has(String(row.id)))
        dates.set(String(row.id), new Date(memoryDateTime(row[date])).toISOString());
    });
    positions.push(
      ...ids.map((assetId) => ({
        assetId,
        tier: 0 as const,
        similarity: 0,
        libraryAddedAt: dates.get(assetId)!,
      })),
    );
  }
  return positions;
}

/** Bound graph loading to the existing canonical semantic-membership and readiness shapes. */
export function semanticFolderIds(where: AssetSearchWhere): string[] {
  const ids = new Set<string>();
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Unsupported semantic read shape');
    return value as Record<string, unknown>;
  };
  const exact = (value: unknown, allowed: string[]) => {
    const input = record(value);
    if (Object.keys(input).some((key) => !allowed.includes(key)))
      throw new Error('Unsupported semantic read shape');
    return input;
  };
  const folderId = (value: unknown) => {
    if (typeof value !== 'string' || !value) throw new Error('Unsupported semantic folder scope');
    ids.add(value);
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || value instanceof Date) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'embeddings') {
        const filter = exact(exact(child, ['some']).some, [
          'ownerId',
          'libraryMode',
          'smartFolderMatches',
        ]);
        const matches = exact(exact(filter.smartFolderMatches, ['some']).some, [
          'ownerId',
          'libraryMode',
          'snapshot',
        ]);
        const snapshot = exact(matches.snapshot, [
          'ownerId',
          'libraryMode',
          'folderId',
          'isActive',
        ]);
        if (snapshot.isActive !== true) throw new Error('Unsupported inactive semantic scope');
        folderId(snapshot.folderId);
      } else if (key === 'owner') {
        const owner = exact(child, ['eagleSmartFolders']);
        const folder = exact(exact(owner.eagleSmartFolders, ['some']).some, [
          'id',
          'ownerId',
          'libraryMode',
          'semanticSnapshots',
        ]);
        const snapshot = exact(exact(folder.semanticSnapshots, ['some']).some, [
          'id',
          'ownerId',
          'libraryMode',
          'isActive',
        ]);
        if (snapshot.isActive !== true) throw new Error('Unsupported inactive semantic scope');
        folderId(folder.id);
      } else visit(child);
    }
  };
  visit(where);
  return [...ids];
}
