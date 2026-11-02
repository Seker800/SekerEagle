import { Prisma, type PrismaClient } from '@prisma/client';
import type { AssetSearchWhere } from './eagle-search-predicate';
import { colorSearchPlan, hasColorSearch, colorCandidateWhere } from './eagle-color-query';
import { readMemoryPage, readMemoryCount, rejectLibraryRead } from './eagle-memory-client';
export { hasColorSearch, colorCandidateWhere } from './eagle-color-query';

type SearchDatabase = Pick<PrismaClient, 'eagleAsset' | '$queryRaw'>;
function searchOrder(
  order:
    | Prisma.EagleAssetOrderByWithRelationInput
    | Prisma.EagleAssetOrderByWithRelationInput[]
    | undefined,
): Prisma.Sql {
  const fields = new Set(['id', 'libraryAddedAt', 'chronologicalAt', 'createdAt', 'updatedAt']);
  const entries = (Array.isArray(order) ? order : order ? [order] : []).flatMap((item) =>
    Object.entries(item),
  );
  if (!entries.length) return Prisma.empty;
  const parts = entries.map(([field, direction]) => {
    if (!fields.has(field) || (direction !== 'asc' && direction !== 'desc'))
      throw new Error('Unsupported color search order');
    return Prisma.sql`${Prisma.raw(`asset."${field}"`)} ${Prisma.raw((direction as string).toUpperCase())}`;
  });
  return Prisma.sql`ORDER BY ${Prisma.join(parts)}`;
}

export async function findSearchAssets<T extends Prisma.EagleAssetFindManyArgs>(
  prisma: SearchDatabase,
  args: Prisma.SelectSubset<T, Prisma.EagleAssetFindManyArgs>,
): Promise<Prisma.EagleAssetGetPayload<T>[]> {
  const ids = await readMemoryPage(args);
  if (ids) {
    if (!ids.length) return [];
    const input: Prisma.EagleAssetFindManyArgs = args;
    const rows = await findSearchAssetsInDatabase(prisma, {
      ...input,
      where: { AND: [args.where ?? {}, { id: { in: ids } }] },
      skip: undefined,
      take: undefined,
    } as Prisma.SelectSubset<T, Prisma.EagleAssetFindManyArgs>);
    // Concurrent changes can invalidate candidates. The original full predicate
    // still owns visibility and eligibility; fall back rather than omit page members.
    if (rows.length === ids.length) {
      const position = new Map(ids.map((id, index) => [id, index]));
      return rows.sort(
        (a, b) => position.get((a as { id: string }).id)! - position.get((b as { id: string }).id)!,
      );
    }
    rejectLibraryRead('page');
  }
  return findSearchAssetsInDatabase(prisma, args);
}

async function findSearchAssetsInDatabase<T extends Prisma.EagleAssetFindManyArgs>(
  prisma: SearchDatabase,
  args: Prisma.SelectSubset<T, Prisma.EagleAssetFindManyArgs>,
): Promise<Prisma.EagleAssetGetPayload<T>[]> {
  if (!hasColorSearch(args.where)) return prisma.eagleAsset.findMany(args);
  if (args.cursor || args.distinct || (args.take !== undefined && args.take < 0))
    throw new Error('Unsupported color search pagination');
  const plan = colorSearchPlan(args.where ?? {});
  const ids = await prisma.$queryRaw<Array<{ id: string; mediaRevision: number }>>(Prisma.sql`
    ${plan.with} SELECT asset.id,asset."mediaRevision" FROM ${plan.from} WHERE ${plan.where}
    ${searchOrder(args.orderBy)} ${args.take === undefined ? Prisma.empty : Prisma.sql`LIMIT ${args.take}`}
    ${args.skip ? Prisma.sql`OFFSET ${args.skip}` : Prisma.empty}
  `);
  if (!ids.length) return [];
  const input: Prisma.EagleAssetFindManyArgs = args;
  const rows = (await prisma.eagleAsset.findMany({
    ...input,
    where: {
      AND: [
        colorCandidateWhere(args.where ?? {}),
        {
          id: { in: ids.map(({ id }) => id) },
          OR: ids.map(({ id, mediaRevision }) => ({ id, mediaRevision })),
        },
      ],
    },
    skip: undefined,
    take: undefined,
  })) as Array<Prisma.EagleAssetGetPayload<T>>;
  const order = new Map(ids.map(({ id }, index) => [id, index]));
  return rows.sort(
    (a, b) => order.get((a as { id: string }).id)! - order.get((b as { id: string }).id)!,
  );
}

export async function countSearchAssets(
  prisma: SearchDatabase,
  { where }: { where: AssetSearchWhere },
): Promise<number> {
  const resident = await readMemoryCount(where);
  if (resident !== null) return resident;
  if (!hasColorSearch(where)) return prisma.eagleAsset.count({ where });
  const plan = colorSearchPlan(where);
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`${plan.with} SELECT count(*) FROM ${plan.from} WHERE ${plan.where}`,
  );
  return Number(row!.count);
}
