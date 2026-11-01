import type { Pool } from 'pg';
import type { MemoryAsset } from './eagle-memory-predicate';
import type { LibraryMemoryIndex } from './eagle-memory-index';
import { residentSmartFolderPage, type ResidentSmartFolderOptions, type SemanticReadGraph } from './eagle-memory-semantic';

/** Load only existing memberships and scores. Model vectors never enter this process. */
export async function withResidentSemanticGraph<T>(
  pool: Pool,
  index: LibraryMemoryIndex,
  folderIds: string[],
  read: (graph: SemanticReadGraph) => T,
  workspaceBytes = Number(process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES ?? 134217728),
) {
  if (!Number.isSafeInteger(workspaceBytes) || workspaceBytes <= 0) throw new Error('Invalid semantic workspace budget');
  const connection = await pool.connect();
  const revision = index.revision;
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await connection.query("SET LOCAL statement_timeout='5s'");
    const parameters = [index.ownerId, index.libraryMode, folderIds];
    const state = await connection.query<{ revision: string }>(
      'SELECT revision::text FROM "EagleLibraryReadState" WHERE "ownerId"=$1 AND "libraryMode"=$2::"LibraryMode"', parameters.slice(0, 2));
    if (state.rows[0]?.revision !== revision) throw new Error('Library read revision changed');
    const snapshots = await connection.query<MemoryAsset & { id: string; folderId: string }>(
      'SELECT id,"ownerId","libraryMode","folderId","isActive" FROM "EagleSmartFolderSemanticSnapshot" WHERE "ownerId"=$1 AND "libraryMode"=$2::"LibraryMode" AND "folderId"=ANY($3::text[]) AND "isActive"', parameters);
    const folders = new Map<string, MemoryAsset>();
    let bytes = Buffer.byteLength(JSON.stringify(snapshots.rows)) * 4;
    const budget = () => { if (bytes > workspaceBytes) throw new Error('Semantic query workspace exhausted'); };
    budget();
    for (const snapshot of snapshots.rows) {
      if (!folders.has(snapshot.folderId)) folders.set(snapshot.folderId, { id: snapshot.folderId,
        ownerId: index.ownerId, libraryMode: index.libraryMode, semanticSnapshots: [] });
      (folders.get(snapshot.folderId)!.semanticSnapshots as MemoryAsset[]).push(snapshot);
    }
    const embeddings = new Map<string, MemoryAsset[]>();
    const scores = new Map<string, Map<number, number>>();
    const graph: SemanticReadGraph = { context: { owner: { id: index.ownerId, eagleSmartFolders: [...folders.values()] }, embeddings }, scores };
    const snapshotById = new Map(snapshots.rows.map(row => [row.id, row]));
    let cursor = ['', ''];
    if (snapshotById.size) while (true) {
      const batch = await connection.query<MemoryAsset & { assetId: string; assetRevision: number; embeddingId: string; snapshotId: string; similarity: number }>(`
        SELECT e.id AS "embeddingId",e."assetId",e."assetRevision",e."spaceId",e.status,e."isCurrent",m."snapshotId",m.similarity
        FROM "EagleSmartFolderSemanticMatch" m JOIN "EagleAssetEmbedding" e
          ON e.id=m."embeddingId" AND e."ownerId"=m."ownerId" AND e."libraryMode"=m."libraryMode"
        WHERE m."ownerId"=$1 AND m."libraryMode"=$2::"LibraryMode" AND m."snapshotId"=ANY($3::text[])
          AND (m."snapshotId",m."embeddingId")>($4,$5)
        ORDER BY m."snapshotId",m."embeddingId" LIMIT 2048`, [index.ownerId, index.libraryMode, [...snapshotById.keys()], ...cursor]);
      bytes += Buffer.byteLength(JSON.stringify(batch.rows)) * 4;
      budget();
      for (const row of batch.rows) {
        if (!embeddings.has(row.assetId)) embeddings.set(row.assetId, []);
        embeddings.get(row.assetId)!.push({ ...row, id: row.embeddingId,
          ownerId: index.ownerId, libraryMode: index.libraryMode,
          smartFolderMatches: [{ ownerId: index.ownerId, libraryMode: index.libraryMode,
            embeddingId: row.embeddingId, snapshotId: row.snapshotId, snapshot: snapshotById.get(row.snapshotId) }] });
        if (!scores.has(row.assetId)) scores.set(row.assetId, new Map());
        const versions = scores.get(row.assetId)!;
        versions.set(row.assetRevision, Math.max(versions.get(row.assetRevision) ?? -Infinity, row.similarity));
      }
      if (batch.rows.length < 2048) break;
      const last = batch.rows.at(-1)!;
      cursor = [last.snapshotId, last.embeddingId];
    }
    // Synchronization may publish while database I/O yields. Never combine two asset epochs.
    if (index.revision !== revision) throw new Error('Library read revision changed');
    const result = read(graph);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export function readResidentSmartFolderPage(pool: Pool, index: LibraryMemoryIndex, options: ResidentSmartFolderOptions, workspaceBytes?: number) {
  return withResidentSemanticGraph(pool, index, options.folderIds,
    graph => residentSmartFolderPage(index, graph, options), workspaceBytes);
}
