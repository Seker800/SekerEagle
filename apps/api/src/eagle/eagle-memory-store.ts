import { memoryPaletteKey } from './eagle-memory-color-score';
import type { SearchColorSwatch } from '@sekereagle/library-core';
import { Prisma } from '@prisma/client';
import { Pool, type PoolClient } from 'pg';
import { LibraryMemoryIndex } from './eagle-memory-index';
import type { MemoryAsset } from './eagle-memory-predicate';
import type { LibraryIdentity } from './library-mode';
import {
  loadResidentSemanticFolders,
  SemanticMemoryBudgetError,
} from './eagle-memory-semantic-store';

async function execute<T extends MemoryAsset>(
  connection: Pick<PoolClient, 'query'>,
  sql: Prisma.Sql,
): Promise<T[]> {
  const result = await connection.query<T>(sql.text, sql.values);
  return result.rows;
}
function readerBudget(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid reader resource budget: ${name}`);
  return value;
}
export const createLibraryReadPool = (connectionString: string) =>
  new Pool({
    connectionString,
    max: readerBudget('EAGLE_READER_DATABASE_CONNECTIONS', 2),
    options: '-c timezone=UTC',
    connectionTimeoutMillis: readerBudget('EAGLE_READER_CONNECT_TIMEOUT_MS', 3000),
    application_name: 'sekereagle-library-reader',
  });

/** Select only read-side information; no image bytes, vectors, credentials or object keys. */
export async function readMemoryAssets(
  tx: Pick<PoolClient, 'query'>,
  scope: LibraryIdentity,
  ids?: string[],
  metadataFactFields?: Prisma.Sql,
  update?: { tables: ReadonlySet<string>; rows: MemoryAsset[] },
): Promise<MemoryAsset[]> {
  if (ids?.length === 0) return [];
  const scopedFor = (
    alias: string,
    key: string,
  ) => Prisma.sql`${Prisma.raw(alias)}."ownerId"=${scope.ownerId}
    AND ${Prisma.raw(alias)}."libraryMode"=${scope.libraryMode}::"LibraryMode"
    ${ids ? Prisma.sql`AND ${Prisma.raw(alias)}.${Prisma.raw('"' + key + '"')} IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))` : Prisma.empty}`;
  const scoped = scopedFor('a', 'id');
  const relationScope = Prisma.sql`${scoped} AND ${scopedFor('c', 'assetId')}`;
  const metadataScope = Prisma.sql`${scoped} AND ${scopedFor('m', 'assetId')}`;
  const needs = (...tables: string[]) =>
    !update || tables.some((table) => update.tables.has(table));
  const assets = update
    ? update.rows.map((row) => ({ ...row }))
    : await execute<MemoryAsset>(
        tx,
        Prisma.sql`
    SELECT a.id,a."ownerId",a."libraryMode",a."normalizedDisplayName",a."originalName",a.format,a."mimeType",
      a."byteSize"::text "byteSize",a.width,a.height,a.rating,a."durationMs",a."aspectRatio",
      a."isPrivate",a."deletedAt" AT TIME ZONE 'UTC' "deletedAt",a."purgeAfter" AT TIME ZONE 'UTC' "purgeAfter",a."mediaRevision",a."rowVersion",
      a."libraryAddedAt" AT TIME ZONE 'UTC' "libraryAddedAt",a."chronologicalAt" AT TIME ZONE 'UTC' "chronologicalAt",a."updatedAt" AT TIME ZONE 'UTC' "updatedAt"
    FROM "EagleAsset" a WHERE ${scoped}`,
      );
  const byId = new Map(assets.map((row) => [row.id, row]));
  for (const row of assets) {
    if (needs('EagleAssetAnnotation')) row.annotation = null;
    if (needs('EaglePhotoMetadata')) {
      row.photoMetadata = null;
      row.statisticsFact = null;
    }
    if (needs('EaglePhotoLocation')) row.photoLocation = null;
    if (needs('EagleAssetManualTag', 'EagleManualTag')) row.manualTagLinks = [];
    if (needs('EagleAssetAiTag')) row.aiTagLinks = [];
    if (needs('EaglePhotoFace')) row.photoFaces = [];
    if (needs('EagleAssetColorAnalysis', 'EagleAssetColorSwatch')) row.colorAnalyses = [];
  }
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
  if (needs('EagleAssetAnnotation'))
    await attach(
      Prisma.sql`SELECT c."assetId",c.description,c."sourceUrl" FROM "EagleAssetAnnotation" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${relationScope}`,
      'annotation',
      false,
    );
  if (needs('EaglePhotoMetadata'))
    await attach(
      Prisma.sql`SELECT m."assetId",m."cameraModel",m."lensModel",m."capturedAt" AT TIME ZONE 'UTC' "capturedAt",m.latitude,m.longitude,
      ${metadataFactFields ? Prisma.sql`CASE WHEN m."assetRevision"=a."mediaRevision" THEN (SELECT row_to_json(fact) FROM (SELECT ${metadataFactFields}) fact) ELSE NULL END` : Prisma.sql`NULL`} AS "statisticsFact"
      FROM "EaglePhotoMetadata" m JOIN "EagleAsset" a ON a.id=m."assetId" WHERE ${metadataScope}`,
      'photoMetadata',
      false,
    );
  if (needs('EaglePhotoLocation'))
    await attach(
      Prisma.sql`SELECT c."assetId",c.name FROM "EaglePhotoLocation" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${relationScope}`,
      'photoLocation',
      false,
    );
  if (needs('EagleAssetManualTag', 'EagleManualTag'))
    await attach(
      Prisma.sql`SELECT c."assetId",c."tagId",jsonb_build_object('normalizedName',t."normalizedName") tag FROM "EagleAssetManualTag" c JOIN "EagleAsset" a ON a.id=c."assetId" JOIN "EagleManualTag" t ON t.id=c."tagId" WHERE ${relationScope}`,
      'manualTagLinks',
      true,
    );
  if (needs('EagleAssetAiTag'))
    await attach(
      Prisma.sql`SELECT c."assetId",c."aiTagId",c.status FROM "EagleAssetAiTag" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${relationScope} AND c.status='ACTIVE'`,
      'aiTagLinks',
      true,
    );
  if (needs('EaglePhotoFace'))
    await attach(
      Prisma.sql`SELECT c."assetId",c."personId",c."isCurrent",c."assetRevision" FROM "EaglePhotoFace" c JOIN "EagleAsset" a ON a.id=c."assetId" WHERE ${relationScope} AND c."isCurrent"`,
      'photoFaces',
      true,
    );
  if (!needs('EagleAssetColorAnalysis', 'EagleAssetColorSwatch')) return assets;
  const colors = await execute<MemoryAsset>(
    tx,
    Prisma.sql`
    SELECT c."assetId",c.id,c."assetRevision",c."processorVersion",c.status,c."isCurrent",
      s.rank,s.hex,s.weight FROM "EagleAssetColorAnalysis" c JOIN "EagleAsset" a ON a.id=c."assetId"
      LEFT JOIN "EagleAssetColorSwatch" s ON s."analysisId"=c.id AND s."ownerId"=c."ownerId" AND s."libraryMode"=c."libraryMode" AND s.rank<2
    WHERE ${relationScope} AND c."isCurrent" ORDER BY c.id,s.rank`,
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

/** One database snapshot defines both resident facts and request-local semantic reads. */
async function readMemorySnapshot(
  connection: Pick<PoolClient, 'query'>,
  scope: LibraryIdentity,
  latest: () => LibraryMemoryIndex | undefined,
  metadataFactFields?: Prisma.Sql,
): Promise<LibraryMemoryIndex> {
  const scoped = Prisma.sql`"ownerId"=${scope.ownerId} AND "libraryMode"=${scope.libraryMode}::"LibraryMode"`;
  const [state] = await execute<{ revision: string; enabled: boolean }>(
    connection,
    Prisma.sql`SELECT revision,enabled FROM "EagleLibraryReadState" WHERE ${scoped}`,
  );
  if (!state?.enabled) throw new Error('Library read state unavailable');
  const revision = String(state.revision);
  const cached = latest();
  if (cached?.revision === revision) return cached;
  const current =
    cached && BigInt(cached.revision) < BigInt(revision) ? cached.snapshot() : undefined;
  const changes = current
    ? await execute<{
        revision: string;
        rebuild: boolean;
        assetIds: string[];
        folderIds: string[];
        sources: string[];
      }>(
        connection,
        Prisma.sql`SELECT revision,rebuild,"assetIds","folderIds","sources" FROM "EagleLibraryReadChange" WHERE ${scoped}
      AND revision>${BigInt(current.revision)} AND revision<=${BigInt(revision)} ORDER BY revision`,
      )
    : [];
  const complete =
    current &&
    changes.length > 0 &&
    BigInt(changes[0]!.revision) === BigInt(current.revision) + 1n &&
    BigInt(changes.at(-1)!.revision) === BigInt(revision) &&
    changes.every(
      (change, at) =>
        at === 0 || BigInt(change.revision) === BigInt(changes[at - 1]!.revision) + 1n,
    );
  const rebuild = !complete || changes.some((change) => change.rebuild);
  const ids = rebuild ? undefined : [...new Set(changes.flatMap((change) => change.assetIds))];
  const tables = new Set(changes.flatMap((change) => change.sources));
  const partial =
    current &&
    ids &&
    changes.every((change) => change.sources?.length || !change.assetIds.length) &&
    !tables.has('EagleAsset');
  const update = partial
    ? {
        tables,
        rows: ids.flatMap((id) => {
          const row = current.get(id);
          return row ? [row] : [];
        }),
      }
    : undefined;
  const rows = await readMemoryAssets(connection, scope, ids, metadataFactFields, update);
  const view = rebuild ? new LibraryMemoryIndex(scope.ownerId, scope.libraryMode) : current;
  if (ids) view.update(revision, ids, rows);
  else view.replace(revision, rows);
  let folderIds = rebuild ? undefined : [...new Set(changes.flatMap((change) => change.folderIds))];
  if (folderIds?.length && !current?.semanticFolders) folderIds = undefined;
  if (folderIds === undefined || folderIds.length) {
    try {
      const prepared = await loadResidentSemanticFolders(connection, scope, folderIds);
      const folders = new Map(rebuild ? [] : current?.semanticFolders);
      for (const id of folderIds ?? []) folders.delete(id);
      for (const [id, graph] of prepared) folders.set(id, graph);
      const bytes = [...folders.values()].reduce((sum, graph) => sum + graph.residentBytes, 0);
      if (bytes > Number(process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES ?? 134217728))
        throw new SemanticMemoryBudgetError();
      view.semanticFolders = folders;
    } catch (error) {
      if (!(error instanceof SemanticMemoryBudgetError)) throw error;
      // Keep ordinary reads available when semantic facts exceed their memory budget.
      view.semanticFolders = undefined;
    }
  }
  return view;
}

/** One independent reader owns its resident scopes. No API lifecycle starts this store. */
export class LibraryReadStore {
  private readonly indexes = new Map<string, LibraryMemoryIndex>();
  private readonly loading = new Map<string, Promise<LibraryMemoryIndex>>();
  private readonly readers = new Map<string, number>();
  constructor(
    private readonly db: Pool,
    private readonly metadataFactFields?: Prisma.Sql,
  ) {}
  async synchronize(scope: LibraryIdentity): Promise<LibraryMemoryIndex> {
    const key = JSON.stringify([scope.ownerId, scope.libraryMode]);
    const running = this.loading.get(key);
    if (running) return running;
    const work = this.load(scope, key);
    this.loading.set(key, work);
    try {
      return await work;
    } finally {
      this.loading.delete(key);
    }
  }
  /** A foreground reader never joins a background refresh. The fence preserves read-after-write. */
  async read(scope: LibraryIdentity, signal?: AbortSignal): Promise<LibraryMemoryIndex> {
    signal?.throwIfAborted();
    const key = JSON.stringify([scope.ownerId, scope.libraryMode]);
    const cached = this.indexes.get(key);
    if (!cached) {
      void this.synchronize(scope).catch(() => undefined);
      throw new Error('Library read snapshot is not ready');
    }
    const [state] = await execute<{ revision: string; enabled: boolean }>(
      this.db,
      Prisma.sql`SELECT revision,enabled FROM "EagleLibraryReadState" WHERE "ownerId"=${scope.ownerId} AND "libraryMode"=${scope.libraryMode}::"LibraryMode"`,
    );
    signal?.throwIfAborted();
    if (!state?.enabled) throw new Error('Library read state unavailable');
    const latest = this.indexes.get(key)!;
    if (BigInt(latest.revision) >= BigInt(state.revision)) return latest;
    return this.readSnapshot(scope, (_connection, view) => view, signal);
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
    const index = await this.readSnapshot(scope, (_connection, view) => view);
    return this.indexes.get(key) ?? index;
  }
  /** A caller's database work and any necessary metadata catch-up share this transaction. */
  async readSnapshot<T>(
    scope: LibraryIdentity,
    read: (connection: Pick<PoolClient, 'query'>, view: LibraryMemoryIndex) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const key = JSON.stringify([scope.ownerId, scope.libraryMode]);
    const baseline = this.indexes.get(key);
    this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
    try {
      const connection = await this.db.connect();
      let inTransaction = false;
      let view: LibraryMemoryIndex;
      let result: T;
      try {
        signal?.throwIfAborted();
        await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        inTransaction = true;
        const timeoutMs = readerBudget('EAGLE_READER_DATABASE_TIMEOUT_MS', 60000);
        await connection.query(`SET LOCAL statement_timeout='${timeoutMs}ms'`);
        view = await readMemorySnapshot(connection, scope, () => baseline, this.metadataFactFields);
        signal?.throwIfAborted();
        result = await read(connection, view);
        await connection.query('COMMIT');
        inTransaction = false;
      } catch (error) {
        if (inTransaction) await connection.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
      const current = this.indexes.get(key);
      if (!current || BigInt(current.revision) < BigInt(view.revision)) {
        this.indexes.set(key, view);
      }
      return result;
    } finally {
      const remaining = this.readers.get(key)! - 1;
      if (remaining) this.readers.set(key, remaining);
      else {
        this.readers.delete(key);
        const published = this.indexes.get(key);
        if (published)
          await execute(
            this.db,
            Prisma.sql`DELETE FROM "EagleLibraryReadChange"
          WHERE "ownerId"=${scope.ownerId} AND "libraryMode"=${scope.libraryMode}::"LibraryMode"
            AND revision<=${BigInt(published.revision)}`,
          );
      }
    }
  }
}
