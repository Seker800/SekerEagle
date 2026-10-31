import { Prisma, type PrismaClient } from '@prisma/client';
import type { LibraryIdentity } from './library-mode';
import type { ImageSearchContext } from './eagle-image-search.service';

function setting(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`Invalid ${name}`);
  return value;
}

/** Only the explicitly sampled preview uses ANN; this is never a membership list or total. */
export async function sampleImageSearch(
  client: Pick<PrismaClient, '$transaction'>,
  scope: LibraryIdentity,
  context: Extract<ImageSearchContext, { status: 'READY' }>,
  threshold: number,
  includePrivate: boolean,
) {
  const ef = setting('EAGLE_IMAGE_SEARCH_PREVIEW_EF_SEARCH', 200, 1000);
  const tuples = setting('EAGLE_IMAGE_SEARCH_PREVIEW_SCAN_TUPLES', 20000, 2147483647);
  const timeout = setting('EAGLE_IMAGE_SEARCH_PREVIEW_TIMEOUT_MS', 15000);
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT set_config('hnsw.ef_search',${String(ef)},true), set_config('hnsw.iterative_scan','strict_order',true), set_config('hnsw.max_scan_tuples',${String(tuples)},true)`,
      );
      return tx.$queryRaw<Array<{ id: string; mediaRevision: number }>>(Prisma.sql`
      WITH nearest AS MATERIALIZED (
        SELECT a.id,a."mediaRevision",e.embedding <=> ${context.vector}::vector AS distance
        FROM "EagleAssetEmbedding" e JOIN "EagleAsset" a
          ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode" AND a."mediaRevision"=e."assetRevision"
        WHERE e."ownerId"=${scope.ownerId} AND e."libraryMode"=${scope.libraryMode}::"LibraryMode"
          AND a."deletedAt" IS NULL ${includePrivate ? Prisma.empty : Prisma.sql`AND NOT a."isPrivate"`}
          AND e."spaceId"=${context.spaceId} AND e."isCurrent" AND e.status='READY' AND e.embedding IS NOT NULL
        ORDER BY e.embedding <=> ${context.vector}::vector LIMIT 100
      ) SELECT id,"mediaRevision" FROM nearest WHERE distance<=${1 - threshold}
      ORDER BY distance,id DESC`);
    },
    { timeout },
  );
}
