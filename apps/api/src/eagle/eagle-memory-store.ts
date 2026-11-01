import { memoryPaletteKey } from './eagle-memory-color-score';
import type { SearchColorSwatch } from '@sekereagle/library-core';
import { Prisma } from '@prisma/client';
import { Pool, type PoolClient } from 'pg';
import { LibraryMemoryIndex } from './eagle-memory-index';
import type { MemoryAsset } from './eagle-memory-predicate';
import type { LibraryIdentity } from './library-mode';

async function execute<T extends MemoryAsset>(
  connection: Pick<PoolClient, 'query'>,
  sql: Prisma.Sql,
): Promise<T[]> {
  const result = await connection.query<T>(sql.text, sql.values);
  return result.rows;
}
export const createLibraryReadPool = (connectionString: string) =>
  new Pool({
    connectionString,
    max: 2,
    options: '-c timezone=UTC',
    connectionTimeoutMillis: 3000,
    application_name: 'sekereagle-library-reader',
  });

/** Select only read-side information; no image bytes, vectors, credentials or object keys. */
export async function readMemoryAssets(
  tx: Pick<PoolClient, 'query'>,
  scope: LibraryIdentity,
  ids?: string[],
  metadataFactFields?: Prisma.Sql,
): Promise<MemoryAsset[]> {
  if (ids?.length === 0) return [];
  const selected = ids
    ? Prisma.sql`AND a.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`
    : Prisma.empty;
  const scoped = Prisma.sql`a."ownerId"=${scope.ownerId} AND a."libraryMode"=${scope.libraryMode}::"LibraryMode" ${selected}`;
  const assets = await execute<MemoryAsset>(
    tx,
    Prisma.sql`
    SELECT a.id,a."ownerId",a."libraryMode",a."normalizedDisplayName",a."originalName",a.format,a."mimeType",
      a."byteSize"::text "byteSize",a.width,a.height,a.rating,a."durationMs",a."aspectRatio",
      a."isPrivate",a."deletedAt" AT TIME ZONE 'UTC' "deletedAt",a."purgeAfter" AT TIME ZONE 'UTC' "purgeAfter",a."mediaRevision",a."rowVersion",
      a."libraryAddedAt" AT TIME ZONE 'UTC' "libraryAddedAt",a."chronologicalAt" AT TIME ZONE 'UTC' "chronologicalAt",a."updatedAt" AT TIME ZONE 'UTC' "updatedAt"
    FROM "EagleAsset" a WHERE ${scoped}`,
  );
  const byId = new Map(assets.map((row) => [row.id, row]));
  for (const row of assets)
    Object.assign(row, {
      annotation: null,
      photoMetadata: null,
      statisticsFact: null,
      photoLocation: null,
      manualTagLinks: [],
      aiTagLinks: [],
      photoFaces: [],
      colorAnalyses: [],
    });
  const attach = async (sql: Prisma.Sql, field: string, many: boolean) => {
    const rows = await execute<MemoryAsset>(tx, sql);
    for (const { assetId, ...child } of rows) {
      const row = byId.get(assetId);
      if (!row) continue;
      if (many) (row[field] as MemoryAsset[]).push(child);
      else {
        if (field === 'photoMetadata') {
          const { statisticsFact, ...metadata } = child;
          row.statisticsFact = statisticsFact;
          row[field] = metadata;
        } else row[field] = child;
      }
    }
  };
  // Set-based reads avoid Prisma's full-library relation parameter expansion.
  await attach(
    Prisma.sql`SELECT c."assetId",c.description,c."sourceUrl" FROM "EagleAssetAnnotation" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped}`,
    'annotation',
    false,
  );
  await attach(
    Prisma.sql`SELECT m."assetId",m."cameraModel",m."lensModel",m."capturedAt" AT TIME ZONE 'UTC' "capturedAt",m.latitude,m.longitude,
      ${metadataFactFields ? Prisma.sql`CASE WHEN m."assetRevision"=a."mediaRevision" THEN (SELECT row_to_json(fact) FROM (SELECT ${metadataFactFields}) fact) ELSE NULL END` : Prisma.sql`NULL`} AS "statisticsFact"
      FROM "EaglePhotoMetadata" m JOIN "EagleAsset" a ON a.id=m."assetId" WHERE ${scoped}`,
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
    Prisma.sql`SELECT c."assetId",c."personId",c."isCurrent",c."assetRevision" FROM "EaglePhotoFace" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${scoped} AND c."isCurrent"`,
    'photoFaces',
    true,
  );
  const colors = await execute<MemoryAsset>(
    tx,
    Prisma.sql`
    SELECT c."assetId",c.id,c."assetRevision",c."processorVersion",c.status,c."isCurrent",
      s.rank,s.hex,s.weight FROM "EagleAssetColorAnalysis" c JOIN "EagleAsset" a ON a.id=c."assetId"
      LEFT JOIN "EagleAssetColorSwatch" s ON s."analysisId"=c.id AND s.rank<2
    WHERE ${scoped} AND c."isCurrent" ORDER BY c.id,s.rank`,
  );
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
  for (const analysis of analyses.values())
    analysis.paletteKey = memoryPaletteKey(analysis.swatches as SearchColorSwatch[]);
  return assets;
}

/** One independent reader owns its resident scopes. No API lifecycle starts this store. */
export class LibraryReadStore {
  private readonly indexes = new Map<string, LibraryMemoryIndex>();
  private readonly loading = new Map<string, Promise<LibraryMemoryIndex>>();
  constructor(
    private readonly db: Pool,
    private readonly metadataFactFields?: Prisma.Sql,
  ) {}
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
    let current = this.indexes.get(key);
    const scoped = Prisma.sql`"ownerId"=${scope.ownerId} AND "libraryMode"=${scope.libraryMode}::"LibraryMode"`;
    let [state] = await execute<{ revision: string; enabled: boolean }>(
      this.db,
      Prisma.sql`SELECT revision,enabled FROM "EagleLibraryReadState" WHERE ${scoped}`,
    );
    if (!state?.enabled) current = undefined;
    if (!current) {
      await execute(
        this.db,
        Prisma.sql`INSERT INTO "EagleLibraryReadState" ("ownerId","libraryMode",enabled) VALUES (${scope.ownerId},${scope.libraryMode}::"LibraryMode",true) ON CONFLICT ("ownerId","libraryMode") DO UPDATE SET enabled=true`,
      );
      [state] = await execute<{ revision: string; enabled: boolean }>(
        this.db,
        Prisma.sql`SELECT revision,enabled FROM "EagleLibraryReadState" WHERE ${scoped}`,
      );
    }
    if (current && current.revision === String(state?.revision ?? 0)) return current;
    const connection = await this.db.connect();
    let next: { revision: string; ids: string[] | undefined; rows: MemoryAsset[] };
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await connection.query("SET LOCAL statement_timeout='60000ms'");
      const [snapshot] = await execute<{ revision: string }>(
        connection,
        Prisma.sql`SELECT revision FROM "EagleLibraryReadState" WHERE ${scoped}`,
      );
      const revision = String(snapshot?.revision ?? 0);
      const changes = current
        ? await execute<{ revision: string; rebuild: boolean; assetIds: string[] }>(
            connection,
            Prisma.sql`SELECT revision,rebuild,"assetIds" FROM "EagleLibraryReadChange" WHERE ${scoped} AND revision>${BigInt(current.revision)} ORDER BY revision`,
          )
        : [];
      const complete =
        current &&
        changes.length > 0 &&
        BigInt(changes[0]!.revision) === BigInt(current.revision) + 1n &&
        BigInt(changes.at(-1)!.revision) === BigInt(revision) &&
        changes.every(
          (change, i) =>
            i === 0 || BigInt(change.revision) === BigInt(changes[i - 1]!.revision) + 1n,
        );
      const rebuild = !complete || changes.some((change) => change.rebuild);
      const ids = rebuild ? undefined : [...new Set(changes.flatMap((change) => change.assetIds))];
      next = {
        revision,
        ids,
        rows: await readMemoryAssets(connection, scope, ids, this.metadataFactFields),
      };
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    const index = current ?? new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
    if (next.ids) index.update(next.revision, next.ids, next.rows);
    else index.replace(next.revision, next.rows);
    this.indexes.set(key, index);
    // Acknowledge only after publication. A restart or a missing journal reconstructs.
    await execute(
      this.db,
      Prisma.sql`DELETE FROM "EagleLibraryReadChange" WHERE ${scoped} AND revision<=${BigInt(index.revision)}`,
    );
    return index;
  }
}
