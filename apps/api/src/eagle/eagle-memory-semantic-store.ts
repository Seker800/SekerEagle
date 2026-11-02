import type { PoolClient } from 'pg';
import type { MemoryAsset } from './eagle-memory-predicate';
import type { LibraryMemoryIndex } from './eagle-memory-index';
import type { LibraryIdentity } from './library-mode';
import {
  residentSmartFolderPage,
  semanticFolderIds,
  type ResidentSmartFolderOptions,
  type SemanticReadGraph,
  type ResidentSemanticGraph,
} from './eagle-memory-semantic';

export class SemanticMemoryBudgetError extends Error {
  constructor() {
    super('Semantic query workspace exhausted');
  }
}
const emptyGraph = (ownerId: string): ResidentSemanticGraph => ({
  context: { owner: { id: ownerId, eagleSmartFolders: [] }, embeddings: new Map() },
  scores: new Map(),
  residentBytes: 0,
});

/** Preparation only: load published memberships and scores, never model vectors. */
export async function loadResidentSemanticFolders(
  connection: Pick<PoolClient, 'query'>,
  scope: LibraryIdentity,
  folderIds?: string[],
  signal?: AbortSignal,
): Promise<Map<string, ResidentSemanticGraph>> {
  const budget = Number(process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES ?? 134217728);
  const batchSize = Number(process.env.EAGLE_READER_SEMANTIC_BATCH_SIZE ?? 2048);
  if (![budget, batchSize].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error('Invalid semantic memory budget');
  signal?.throwIfAborted();
  const graphs = new Map<string, ResidentSemanticGraph>();
  if (folderIds?.length === 0) return graphs;
  const snapshots = (
    await connection.query<MemoryAsset & { id: string; folderId: string }>(
      `SELECT id,"ownerId","libraryMode","folderId","isActive" FROM "EagleSmartFolderSemanticSnapshot"
      WHERE "ownerId"=$1 AND "libraryMode"=$2::"LibraryMode" AND "isActive"
      ${folderIds ? 'AND "folderId"=ANY($3::text[])' : ''}`,
      folderIds
        ? [scope.ownerId, scope.libraryMode, folderIds]
        : [scope.ownerId, scope.libraryMode],
    )
  ).rows;
  let bytes = Buffer.byteLength(JSON.stringify(snapshots)) * 4;
  if (bytes > budget) throw new SemanticMemoryBudgetError();
  for (const snapshot of snapshots) {
    let graph = graphs.get(snapshot.folderId);
    if (!graph) {
      graph = emptyGraph(scope.ownerId);
      graph.context.owner.eagleSmartFolders = [
        { id: snapshot.folderId, ...scope, semanticSnapshots: [] },
      ];
      graphs.set(snapshot.folderId, graph);
    }
    const folder = (graph.context.owner.eagleSmartFolders as MemoryAsset[])[0]!;
    (folder.semanticSnapshots as MemoryAsset[]).push(snapshot);
    graph.residentBytes += Buffer.byteLength(JSON.stringify(snapshot)) * 4;
  }
  const bySnapshot = new Map(snapshots.map((row) => [row.id, row]));
  let cursor = ['', ''];
  if (snapshots.length)
    while (true) {
      signal?.throwIfAborted();
      const batch = (
        await connection.query<
          MemoryAsset & {
            assetId: string;
            assetRevision: number;
            embeddingId: string;
            snapshotId: string;
            similarity: number;
          }
        >(
          `
      SELECT e.id AS "embeddingId",e."assetId",e."assetRevision",e."spaceId",e.status,e."isCurrent",m."snapshotId",m.similarity
      FROM "EagleSmartFolderSemanticMatch" m JOIN "EagleAssetEmbedding" e
        ON e.id=m."embeddingId" AND e."ownerId"=m."ownerId" AND e."libraryMode"=m."libraryMode"
      WHERE m."ownerId"=$1 AND m."libraryMode"=$2::"LibraryMode" AND m."snapshotId"=ANY($3::text[])
        AND (m."snapshotId",m."embeddingId")>($4,$5)
      ORDER BY m."snapshotId",m."embeddingId" LIMIT $6`,
          [scope.ownerId, scope.libraryMode, [...bySnapshot.keys()], ...cursor, batchSize],
        )
      ).rows;
      signal?.throwIfAborted();
      bytes += Buffer.byteLength(JSON.stringify(batch)) * 4;
      if (bytes > budget) throw new SemanticMemoryBudgetError();
      for (const row of batch) {
        const snapshot = bySnapshot.get(row.snapshotId)!;
        const graph = graphs.get(snapshot.folderId)!;
        const embeddings = graph.context.embeddings as Map<string, MemoryAsset[]>;
        const scores = graph.scores as Map<string, Map<number, number>>;
        if (!embeddings.has(row.assetId)) embeddings.set(row.assetId, []);
        embeddings.get(row.assetId)!.push({
          ...row,
          id: row.embeddingId,
          ...scope,
          smartFolderMatches: [
            { ...scope, embeddingId: row.embeddingId, snapshotId: row.snapshotId, snapshot },
          ],
        });
        if (!scores.has(row.assetId)) scores.set(row.assetId, new Map());
        const versions = scores.get(row.assetId)!;
        versions.set(
          row.assetRevision,
          Math.max(versions.get(row.assetRevision) ?? -Infinity, row.similarity),
        );
        graph.residentBytes += Buffer.byteLength(JSON.stringify(row)) * 4;
      }
      if (batch.length < batchSize) break;
      const last = batch.at(-1)!;
      cursor = [last.snapshotId, last.embeddingId];
    }
  return graphs;
}

/** All data has been prepared before publication. Querying never opens a database transaction. */
export function withResidentSemanticGraph<T>(
  index: LibraryMemoryIndex,
  folderIds: string[],
  read: (graph: SemanticReadGraph, view: LibraryMemoryIndex) => T,
  workspaceBytes = Number(process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES ?? 134217728),
  signal?: AbortSignal,
): T {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(workspaceBytes) || workspaceBytes <= 0)
    throw new Error('Invalid semantic workspace budget');
  if (!index.semanticFolders) throw new Error('Semantic facts are not ready');
  const selected = [...new Set(folderIds)].flatMap((id) => {
    const graph = index.semanticFolders!.get(id);
    return graph ? [graph] : [];
  });
  if (
    index.size * 64 + selected.reduce((bytes, graph) => bytes + graph.residentBytes, 0) >
    workspaceBytes
  )
    throw new SemanticMemoryBudgetError();
  if (selected.length === 1) return read(selected[0]!, index);
  const combined = emptyGraph(index.ownerId);
  const folders: MemoryAsset[] = [];
  const embeddings = combined.context.embeddings as Map<string, MemoryAsset[]>;
  const scores = combined.scores as Map<string, Map<number, number>>;
  for (const graph of selected) {
    folders.push(...(graph.context.owner.eagleSmartFolders as MemoryAsset[]));
    for (const [assetId, rows] of graph.context.embeddings)
      embeddings.set(assetId, [...(embeddings.get(assetId) ?? []), ...rows]);
    for (const [assetId, versions] of graph.scores) {
      if (!scores.has(assetId)) scores.set(assetId, new Map());
      for (const [revision, similarity] of versions)
        scores
          .get(assetId)!
          .set(revision, Math.max(scores.get(assetId)!.get(revision) ?? -Infinity, similarity));
    }
  }
  combined.context.owner.eagleSmartFolders = folders;
  return read(combined, index);
}

export function readResidentSmartFolderPage(
  index: LibraryMemoryIndex,
  options: ResidentSmartFolderOptions,
  workspaceBytes?: number,
  signal?: AbortSignal,
) {
  if (semanticFolderIds(options.where).some((id) => !options.folderIds.includes(id)))
    throw new Error('Unsupported semantic folder scope');
  return withResidentSemanticGraph(
    index,
    options.folderIds,
    (graph, view) => ({
      revision: view.revision,
      positions: residentSmartFolderPage(view, graph, options),
    }),
    workspaceBytes,
    signal,
  );
}
