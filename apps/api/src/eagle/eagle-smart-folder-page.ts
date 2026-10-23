import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { smartFolderMatchWhere } from '@sekereagle/library-persistence';
import { assetDateField } from './eagle-asset-order';
import { decodeImageSearchCursor, encodeImageSearchCursor } from './eagle-search-cursor';
import { rankSmartFolderMatches } from './eagle-smart-folder-ranking';
import type { ImageSearchPosition } from './eagle-image-search.service';
import type { LibraryIdentity } from './library-mode';
import type { ListEagleAssetsDto } from './eagle.dto';
import type { PrismaService } from '../prisma/prisma.service';

interface Options {
  scope: LibraryIdentity;
  query: ListEagleAssetsDto;
  folderIds: string[];
  folderDefinitionKey: string;
  includePrivate: boolean;
  trash: boolean;
}

/** Cached ranking owns pagination; the caller owns shared visibility/filtering and projection. */
export async function readSmartFolderPage<
  T extends { id: string; chronologicalAt: Date; libraryAddedAt: Date },
>(
  prisma: PrismaService,
  { scope, query, folderIds, folderDefinitionKey, includePrivate, trash }: Options,
  readAssets: (
    where: Prisma.EagleAssetWhereInput,
    options?: {
      take: number;
      orderBy: Prisma.EagleAssetOrderByWithRelationInput[];
    },
  ) => Promise<T[]>,
) {
  const snapshots = await prisma.eagleSmartFolderSemanticSnapshot.findMany({
    where: {
      ownerId: scope.ownerId,
      libraryMode: scope.libraryMode,
      folderId: { in: folderIds },
      isActive: true,
    },
    select: { id: true, folder: { select: { rowVersion: true } } },
    orderBy: { id: 'asc' },
  });
  const searchKey = createHash('sha256')
    .update(
      JSON.stringify([
        'smart-folder-relevance',
        scope,
        query.smartFolderId,
        folderDefinitionKey,
        { ...query, cursor: undefined, limit: undefined },
        includePrivate,
        trash,
        snapshots.map((snapshot) => [snapshot.id, snapshot.folder.rowVersion]),
      ]),
    )
    .digest('hex');
  let after = decodeImageSearchCursor(query.cursor, searchKey, scope);
  const ranked: Array<{ row: T; position: ImageSearchPosition }> = [];
  while (after?.tier !== 0 && ranked.length <= query.limit) {
    const candidates = await rankSmartFolderMatches(
      prisma,
      scope,
      folderIds,
      after,
      250,
      includePrivate,
      trash,
    );
    if (!candidates.length) break;
    const rows = await readAssets({ id: { in: candidates.map((candidate) => candidate.assetId) } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const position of candidates) {
      const row = byId.get(position.assetId);
      if (row) ranked.push({ row, position });
      if (ranked.length > query.limit) break;
    }
    after = candidates.at(-1);
    if (candidates.length < 250) break;
  }
  if (ranked.length <= query.limit) {
    // A parent can union semantic and ordinary-only children. Keep ordinary members too,
    // after relevance hits, using the mode's normal date order and the same query contract.
    const dateField = assetDateField(scope.libraryMode);
    const remainder = await readAssets(
      {
        AND: [
          { NOT: { OR: folderIds.map((folderId) => smartFolderMatchWhere(scope, folderId)) } },
          ...(after?.tier === 0
            ? [
                {
                  OR: [
                    { [dateField]: { lt: new Date(after.libraryAddedAt) } },
                    { [dateField]: new Date(after.libraryAddedAt), id: { lt: after.assetId } },
                  ],
                },
              ]
            : []),
        ],
      },
      { take: query.limit + 1 - ranked.length, orderBy: [{ [dateField]: 'desc' }, { id: 'desc' }] },
    );
    ranked.push(
      ...remainder.map((row) => ({
        row,
        position: {
          assetId: row.id,
          tier: 0,
          similarity: 0,
          libraryAddedAt: row[dateField].toISOString(),
        },
      })),
    );
  }
  const page = ranked.slice(0, query.limit);
  return {
    rows: page.map(({ row }) => row),
    nextCursor:
      ranked.length > query.limit && page.length
        ? encodeImageSearchCursor(searchKey, page.at(-1)!.position, scope)
        : null,
  };
}
