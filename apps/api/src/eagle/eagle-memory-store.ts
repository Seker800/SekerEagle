import { Prisma, type PrismaClient } from '@prisma/client';
import { LibraryMemoryIndex } from './eagle-memory-index';
import type { MemoryAsset } from './eagle-memory-predicate';
import type { LibraryIdentity } from './library-mode';

/** Select only read-side information; no image bytes, vectors, credentials or object keys. */
export async function readMemoryAssets(
  tx: Prisma.TransactionClient,
  scope: LibraryIdentity,
  ids?: string[],
): Promise<MemoryAsset[]> {
  if (ids?.length === 0) return [];
  const selected = ids
    ? Prisma.sql`AND a.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`
    : Prisma.empty;
  const scoped = Prisma.sql`a."ownerId"=${scope.ownerId} AND a."libraryMode"=${scope.libraryMode}::"LibraryMode" ${selected}`;
  const assets = await tx.$queryRaw<MemoryAsset[]>(Prisma.sql`
    SELECT a.id,a."ownerId",a."libraryMode",a."normalizedDisplayName",a."originalName",a.format,a."mimeType",
      a."byteSize"::text "byteSize",a.width,a.height,a.rating,a."durationMs",a."aspectRatio",
      a."isPrivate",a."deletedAt",a."purgeAfter",a."mediaRevision",a."rowVersion",
      a."libraryAddedAt",a."chronologicalAt",a."updatedAt"
    FROM "EagleAsset" a WHERE ${scoped}`);
  const byId = new Map(assets.map((row) => [row.id, row]));
  for (const row of assets)
    Object.assign(row, {
      annotation: null,
      photoMetadata: null,
      photoLocation: null,
      manualTagLinks: [],
      aiTagLinks: [],
      photoFaces: [],
      colorAnalyses: [],
    });
  const attach = async (sql: Prisma.Sql, field: string, many: boolean) => {
    const rows = await tx.$queryRaw<MemoryAsset[]>(sql);
    for (const { assetId, ...child } of rows) {
      const row = byId.get(assetId);
      if (!row) continue;
      if (many) (row[field] as MemoryAsset[]).push(child);
      else row[field] = child;
    }
  };
  // Set-based reads avoid Prisma's full-library relation parameter expansion.
  await attach(
    Prisma.sql`SELECT c."assetId",c.description,c."sourceUrl" FROM "EagleAssetAnnotation" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped}`,
    'annotation',
    false,
  );
  await attach(
    Prisma.sql`SELECT c."assetId",c."cameraModel",c."lensModel",c."capturedAt",c.latitude,c.longitude FROM "EaglePhotoMetadata" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped}`,
    'photoMetadata',
    false,
  );
  await attach(
    Prisma.sql`SELECT c."assetId",c.name FROM "EaglePhotoLocation" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped}`,
    'photoLocation',
    false,
  );
  await attach(
    Prisma.sql`SELECT c."assetId",c."tagId",jsonb_build_object('normalizedName',t."normalizedName") tag FROM "EagleAssetManualTag" c JOIN "EagleAsset" a ON a.id=c."assetId" JOIN "EagleManualTag" t ON t.id=c."tagId" WHERE ${scoped}`,
    'manualTagLinks',
    true,
  );
  await attach(
    Prisma.sql`SELECT c."assetId",c."aiTagId",c.status FROM "EagleAssetAiTag" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped} AND c.status='ACTIVE'`,
    'aiTagLinks',
    true,
  );
  await attach(
    Prisma.sql`SELECT c."assetId",c."personId",c."isCurrent" FROM "EaglePhotoFace" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped} AND c."isCurrent"`,
    'photoFaces',
    true,
  );
  const colors = await tx.$queryRaw<MemoryAsset[]>(Prisma.sql`
    SELECT c."assetId",c.id,c."assetRevision",c."processorVersion",c.status,c."isCurrent",
      s.rank,s.hex,s.weight FROM "EagleAssetColorAnalysis" c JOIN "EagleAsset" a ON a.id=c."assetId"
      LEFT JOIN "EagleAssetColorSwatch" s ON s."analysisId"=c.id AND s.rank<2
    WHERE ${scoped} AND c."isCurrent" ORDER BY c.id,s.rank`);
  const analyses = new Map<unknown, MemoryAsset>();
  for (const { assetId, rank, hex, weight, ...analysis } of colors) {
    let entry = analyses.get(analysis.id);
    if (!entry) {
      entry = { ...analysis, swatches: [] };
      analyses.set(analysis.id, entry);
      (byId.get(assetId)?.colorAnalyses as MemoryAsset[] | undefined)?.push(entry);
    }
    if (rank != null) (entry.swatches as MemoryAsset[]).push({ hex, weight });
  }
  return assets;
}

/** One independent reader owns its resident scopes. No API lifecycle starts this store. */
export class LibraryReadStore {
  private readonly indexes = new Map<string, LibraryMemoryIndex>();
  private readonly loading = new Map<string, Promise<LibraryMemoryIndex>>();
  constructor(private readonly db: PrismaClient) {}
  async synchronize(scope: LibraryIdentity): Promise<LibraryMemoryIndex> {
    const key = JSON.stringify([scope.ownerId, scope.libraryMode]);
    const running = this.loading.get(key);
    if (running) {
      await running;
      return this.synchronize(scope);
    }
    const work = this.load(scope, key);
    this.loading.set(key, work);
    try {
      return await work;
    } finally {
      this.loading.delete(key);
    }
  }
  private async load(scope: LibraryIdentity, key: string) {
    const current = this.indexes.get(key);
    const state = await this.db.eagleLibraryReadState.findUnique({
      where: { ownerId_libraryMode: scope },
    });
    if (current && current.revision === String(state?.revision ?? 0)) return current;
    const next = await this.db.$transaction(
      async (tx) => {
        const snapshot = await tx.eagleLibraryReadState.findUnique({
          where: { ownerId_libraryMode: scope },
        });
        const revision = String(snapshot?.revision ?? 0);
        const changes = current
          ? await tx.eagleLibraryReadChange.findMany({
              where: { ...scope, revision: { gt: BigInt(current.revision) } },
              orderBy: { revision: 'asc' },
            })
          : [];
        const complete =
          current &&
          changes.length > 0 &&
          changes[0]!.revision === BigInt(current.revision) + 1n &&
          changes.at(-1)!.revision === BigInt(revision) &&
          changes.every(
            (change, i) => i === 0 || change.revision === changes[i - 1]!.revision + 1n,
          );
        const rebuild = !complete || changes.some((change) => change.rebuild);
        const ids = rebuild
          ? undefined
          : [...new Set(changes.flatMap((change) => change.assetIds))];
        return { revision, ids, rows: await readMemoryAssets(tx, scope, ids) };
      },
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    );
    const index = current ?? new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
    if (next.ids) index.update(next.revision, next.ids, next.rows);
    else index.replace(next.revision, next.rows);
    this.indexes.set(key, index);
    // No event is acknowledged before a successful publication. Restart reconstructs
    // from canonical rows, and another reader detecting a gap also reconstructs.
    await this.db.eagleLibraryReadChange.deleteMany({
      where: { ...scope, revision: { lte: BigInt(index.revision) } },
    });
    return index;
  }
}
