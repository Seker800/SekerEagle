import { readMemoryColorPage } from './eagle-memory-client';
import { BadRequestException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { LibraryIdentity } from './library-mode';
import type { ListEagleAssetsDto } from './eagle.dto';
import type { AssetSearchWhere } from './eagle-search-predicate';
import { colorSearchPlan } from './eagle-color-query';
import { assetDateField } from './eagle-asset-order';
import { assetListInclude } from './eagle-asset-projection';
import { colorCandidateWhere } from './eagle-asset-search';

interface ColorPosition {
  id: string;
  score: number;
  time: string;
  newer?: true;
}
export function encodeColorCursor(
  position: ColorPosition,
  scope: LibraryIdentity,
  key: string,
): string {
  return (
    'color:' + Buffer.from(JSON.stringify({ v: 1, ...scope, key, position })).toString('base64url')
  );
}
export function decodeColorCursor(
  value: string,
  scope: LibraryIdentity,
  key: string,
): ColorPosition {
  try {
    if (!value.startsWith('color:')) throw Error();
    const data = JSON.parse(Buffer.from(value.slice(6), 'base64url').toString('utf8')) as {
      v?: unknown;
      ownerId?: unknown;
      libraryMode?: unknown;
      key?: unknown;
      position?: Partial<ColorPosition>;
    };
    const p = data.position;
    if (
      data.v !== 1 ||
      data.ownerId !== scope.ownerId ||
      data.libraryMode !== scope.libraryMode ||
      data.key !== key ||
      !p ||
      typeof p.id !== 'string' ||
      !p.id ||
      p.id.length > 128 ||
      typeof p.score !== 'number' ||
      !Number.isFinite(p.score) ||
      p.score < 0 ||
      typeof p.time !== 'string' ||
      !Number.isFinite(Date.parse(p.time)) ||
      (p.newer !== undefined && p.newer !== true)
    )
      throw Error();
    return p as ColorPosition;
  } catch {
    throw new BadRequestException('颜色筛选游标无效，请重新筛选。');
  }
}

export function colorPageKey(
  query: ListEagleAssetsDto,
  color: string,
  includePrivate: boolean,
  trash: boolean,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        query: Object.fromEntries(
          Object.entries(query).filter(([k]) => !['limit', 'cursor'].includes(k)),
        ),
        includePrivate,
        trash,
        color,
        version: 1,
      }),
    )
    .digest('hex');
}

export async function readColorAssetPage(
  prisma: Pick<PrismaClient, '$queryRaw' | 'eagleAsset'>,
  scope: LibraryIdentity,
  query: ListEagleAssetsDto,
  where: AssetSearchWhere,
  color: string,
  includePrivate: boolean,
  trash: boolean,
  useReader = true,
): Promise<{
  rows: Prisma.EagleAssetGetPayload<{ include: typeof assetListInclude }>[];
  previousCursor: string | null;
  nextCursor: string | null;
}> {
  const key = colorPageKey(query, color, includePrivate, trash);
  const cursor = query.cursor ? decodeColorCursor(query.cursor, scope, key) : undefined;
  const newer = Boolean(cursor?.newer);
  const date = Prisma.raw(`asset."${assetDateField(scope.libraryMode, query.sort)}"`);
  const boundary = cursor
    ? Prisma.sql`AND (score ${Prisma.raw(newer ? '<' : '>')} ${cursor.score}
    OR (score=${cursor.score} AND (time,id) ${Prisma.raw(newer ? '>' : '<')} (${new Date(cursor.time)},${cursor.id})))`
    : Prisma.empty;
  // Eagle ranks through `colorDistancesMap[id] || 100`, including the zero-distance fallback.
  const plan = colorSearchPlan(where, color);
  const resident = useReader
    ? await readMemoryColorPage(scope, {
        where,
        color,
        date: assetDateField(scope.libraryMode, query.sort),
        limit: query.limit,
        offset: query.offset ?? 0,
        after: cursor,
      })
    : null;
  const candidates =
    resident?.map((row) => ({ ...row, time: new Date(row.time) })) ??
    (await prisma.$queryRaw<
      Array<{ id: string; score: number; time: Date; mediaRevision: number }>
    >(Prisma.sql`
    ${plan.with}, ranked AS MATERIALIZED (
      SELECT asset.id,asset."mediaRevision",${date} time,coalesce(nullif(${plan.score},0),100) score
      FROM ${plan.from} WHERE ${plan.where}
    ) SELECT id,score,time,"mediaRevision" FROM ranked WHERE TRUE ${boundary}
      ORDER BY score ${Prisma.raw(newer ? 'DESC' : 'ASC')},time ${Prisma.raw(newer ? 'ASC' : 'DESC')},id ${Prisma.raw(newer ? 'ASC' : 'DESC')}
      LIMIT ${query.limit + 1} ${query.offset ? Prisma.sql`OFFSET ${query.offset}` : Prisma.empty}
  `));
  const hasMore = candidates.length > query.limit;
  const page = candidates.slice(0, query.limit);
  if (newer) page.reverse();
  const rows = page.length
    ? await prisma.eagleAsset.findMany({
        where: {
          AND: [
            colorCandidateWhere(where),
            {
              ownerId: scope.ownerId,
              libraryMode: scope.libraryMode,
              id: { in: page.map((p) => p.id) },
              OR: page.map(({ id, mediaRevision }) => ({ id, mediaRevision })),
            },
          ],
        },
        include: assetListInclude,
      })
    : [];
  if (resident && rows.length !== page.length)
    return readColorAssetPage(prisma, scope, query, where, color, includePrivate, trash, false);
  const positions = new Map(page.map((p, index) => [p.id, index]));
  rows.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  const position = (p: (typeof page)[number], newer?: true): ColorPosition => ({
    id: p.id,
    score: p.score,
    time: p.time.toISOString(),
    ...(newer ? { newer } : {}),
  });
  return {
    rows,
    previousCursor:
      page.length && (newer ? hasMore : Boolean(cursor))
        ? encodeColorCursor(position(page[0]!, true), scope, key)
        : null,
    nextCursor:
      page.length && (newer ? Boolean(cursor) : hasMore)
        ? encodeColorCursor(position(page.at(-1)!), scope, key)
        : null,
  };
}
