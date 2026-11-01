import type { MemoryColorPageOptions } from './eagle-memory-color';
import type { Prisma } from '@prisma/client';
import {
  encodeMemoryQuery,
  memorySearchPositions,
  memoryColorPosition,
} from './eagle-memory-protocol';
import type { ResidentSmartFolderOptions } from './eagle-memory-semantic';
import type { AssetSearchWhere } from './eagle-search-predicate';

/** Diagnostic counters only: never retain predicates, names, owner IDs or tokens. */
export const libraryReadMetrics = { hits: 0, fallbacks: 0, unsupported: 0 };
function scopeOf(where: AssetSearchWhere) {
  const owners = new Set<string>(),
    modes = new Set<string>();
  const visit = (part: AssetSearchWhere) => {
    if (typeof part.ownerId === 'string') owners.add(part.ownerId);
    if (typeof part.libraryMode === 'string') modes.add(part.libraryMode);
    for (const child of Array.isArray(part.AND) ? part.AND : part.AND ? [part.AND] : [])
      visit(child);
  };
  visit(where);
  if (owners.size !== 1 || modes.size !== 1) return null;
  const ownerId = [...owners][0]!,
    libraryMode = [...modes][0]!;
  return ['PHOTO', 'MATERIAL'].includes(libraryMode) ? { ownerId, libraryMode } : null;
}

export async function requestLibraryRead(where: AssetSearchWhere, page: Record<string, unknown>) {
  const endpoint = process.env.EAGLE_READER_URL,
    token = process.env.EAGLE_READER_TOKEN;
  if (!endpoint || !token) return null;
  const scope = scopeOf(where);
  if (!scope) {
    libraryReadMetrics.unsupported++;
    return null;
  }
  try {
    const response = await fetch(new URL('/query', endpoint), {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: encodeMemoryQuery({ ...page, scope, where }),
      signal: AbortSignal.timeout(
        Number(
          page.action === 'smartFolderPage' || page.action === 'colorPage'
            ? (process.env.EAGLE_READER_COMPLEX_TIMEOUT_MS ?? 1000)
            : (process.env.EAGLE_READER_TIMEOUT_MS ?? 200),
        ),
      ),
    });
    if (!response.ok) {
      await response.body?.cancel();
      libraryReadMetrics.fallbacks++;
      return null;
    }
    return (await response.json()) as {
      ids?: unknown;
      count?: unknown;
      revision?: unknown;
      summary?: unknown;
      counts?: unknown;
      positions?: unknown;
      facets?: unknown;
    };
  } catch {
    libraryReadMetrics.fallbacks++;
    return null;
  }
}

export async function readMemoryPage(
  args: Prisma.EagleAssetFindManyArgs,
): Promise<string[] | null> {
  if (args.select && args.select.id !== true) return null;
  if (!args.where || args.take === undefined || args.take < 0 || args.cursor || args.distinct)
    return null;
  const orders = (
    Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : []
  ).flatMap((part) => Object.entries(part));
  if (
    orders.length !== 2 ||
    !['libraryAddedAt', 'chronologicalAt'].includes(orders[0]![0]) ||
    orders[1]![0] !== 'id' ||
    orders[0]![1] !== orders[1]![1] ||
    !['asc', 'desc'].includes(orders[0]![1] as string)
  )
    return null;
  const result = await requestLibraryRead(args.where, {
    action: 'page',
    date: orders[0]![0],
    direction: orders[0]![1],
    take: args.take,
    skip: args.skip ?? 0,
  });
  if (
    !result ||
    !Array.isArray(result.ids) ||
    result.ids.length > args.take ||
    result.ids.some((id) => typeof id !== 'string') ||
    new Set(result.ids).size !== result.ids.length
  )
    return null;
  libraryReadMetrics.hits++;
  return result.ids as string[];
}
export async function readMemoryCount(where: AssetSearchWhere): Promise<number | null> {
  const result = await requestLibraryRead(where, { action: 'count' });
  if (!result || !Number.isSafeInteger(result.count) || (result.count as number) < 0) return null;
  libraryReadMetrics.hits++;
  return result.count as number;
}

export async function readMemorySmartFolderPage(
  scope: { ownerId: string; libraryMode: 'PHOTO' | 'MATERIAL' },
  options: ResidentSmartFolderOptions,
) {
  const { where, ...semantic } = options;
  const result = await requestLibraryRead(
    { AND: [scope, where] },
    { action: 'smartFolderPage', semantic },
  );
  if (!result) return null;
  const parsed = memorySearchPositions.safeParse(result.positions);
  if (
    !parsed.success ||
    parsed.data.length > options.limit + 1 ||
    new Set(parsed.data.map((row) => row.assetId)).size !== parsed.data.length
  )
    return null;
  libraryReadMetrics.hits++;
  return parsed.data;
}

export async function readMemoryColorPage(
  scope: { ownerId: string; libraryMode: 'PHOTO' | 'MATERIAL' },
  options: MemoryColorPageOptions,
) {
  const { where, ...colorPage } = options;
  const result = await requestLibraryRead(
    { AND: [scope, where] },
    { action: 'colorPage', colorPage },
  );
  if (!result) return null;
  const parsed = memoryColorPosition.array().safeParse(result.positions);
  if (
    !parsed.success ||
    parsed.data.length > options.limit + 1 ||
    new Set(parsed.data.map((row) => row.id)).size !== parsed.data.length
  )
    return null;
  libraryReadMetrics.hits++;
  return parsed.data;
}
