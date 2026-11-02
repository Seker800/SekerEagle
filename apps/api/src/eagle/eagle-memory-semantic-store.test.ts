import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from './eagle-memory-index';
import {
  loadResidentSemanticFolders,
  withResidentSemanticGraph,
} from './eagle-memory-semantic-store';

const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
function source(abort?: AbortController) {
  let batches = 0;
  let queries = 0;
  return {
    get batches() {
      return batches;
    },
    get queries() {
      return queries;
    },
    query: async (sql: string) => {
      queries++;
      if (sql.includes('FROM "EagleSmartFolderSemanticSnapshot"'))
        return { rows: [{ id: 'snapshot', folderId: 'folder', ...scope, isActive: true }] };
      if (sql.includes('FROM "EagleSmartFolderSemanticMatch"')) {
        batches++;
        abort?.abort();
        return {
          rows: [
            {
              assetId: 'a',
              assetRevision: 0,
              embeddingId: 'embedding',
              snapshotId: 'snapshot',
              similarity: 0.9,
              ...scope,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
}
test('cancelled semantic preparation never publishes partial memberships', async () => {
  const abort = new AbortController();
  const db = source(abort);
  await assert.rejects(
    loadResidentSemanticFolders(db as never, scope, undefined, abort.signal),
    /abort/i,
  );
  assert.equal(db.batches, 1);
});
test('repeated semantic reads reuse prepared memberships with no database I/O', async () => {
  const db = source();
  const index = new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
  index.replace('1', []);
  index.semanticFolders = await loadResidentSemanticFolders(db as never, scope);
  const queries = db.queries;
  for (let i = 0; i < 3; i++) {
    const score = withResidentSemanticGraph(index, ['folder'], (graph) =>
      graph.scores.get('a')?.get(0),
    );
    assert.equal(score, 0.9);
  }
  assert.equal(db.queries, queries);
  const copy = index.snapshot();
  index.semanticFolders = new Map();
  assert.equal(
    withResidentSemanticGraph(copy, ['folder'], (graph) => graph.scores.size),
    1,
  );
});

test('semantic reads retain empty readiness, workspace and explicit folder scope guards', async () => {
  const { readResidentSmartFolderPage } = await import('./eagle-memory-semantic-store');
  const { smartFolderMatchWhere } = await import('@sekereagle/library-persistence');
  const index = new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
  index.replace('1', []);
  assert.throws(() => withResidentSemanticGraph(index, [], () => 0), /not ready/);
  index.semanticFolders = new Map();
  assert.equal(
    withResidentSemanticGraph(index, ['missing'], (graph) => graph.scores.size),
    0,
  );
  assert.throws(() => withResidentSemanticGraph(index, [], () => 0, 0), /budget/);
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(
    () => withResidentSemanticGraph(index, [], () => 0, undefined, cancelled.signal),
    /abort/i,
  );
  assert.throws(
    () =>
      readResidentSmartFolderPage(index, {
        where: smartFolderMatchWhere(scope, 'different'),
        folderIds: ['folder'],
        limit: 3,
        ordinaryMembersPossible: false,
        includePrivate: false,
        trash: false,
      }),
    /scope/,
  );
  const db = source();
  index.semanticFolders = await loadResidentSemanticFolders(db as never, scope);
  assert.throws(() => withResidentSemanticGraph(index, ['folder'], () => 0, 1), /workspace/);
});

test('preparation budgets fail explicitly and empty folder changes never touch the database', async () => {
  const db = source();
  assert.equal((await loadResidentSemanticFolders(db as never, scope, [])).size, 0);
  assert.equal(db.queries, 0);
  const previous = process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES;
  try {
    process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES = '0';
    await assert.rejects(loadResidentSemanticFolders(db as never, scope), /budget/);
    process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES = '1';
    await assert.rejects(loadResidentSemanticFolders(db as never, scope), /workspace/);
  } finally {
    if (previous === undefined) delete process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES;
    else process.env.EAGLE_READER_QUERY_WORKSPACE_BYTES = previous;
  }
});

test('multiple folders preserve memberships and maximum scores without mutating published facts', async () => {
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('FROM "EagleSmartFolderSemanticSnapshot"')
        ? [
            { id: 's1', folderId: 'one', ...scope, isActive: true },
            { id: 's2', folderId: 'two', ...scope, isActive: true },
          ]
        : [
            {
              assetId: 'a',
              assetRevision: 0,
              embeddingId: 'e1',
              snapshotId: 's1',
              similarity: 0.7,
            },
            {
              assetId: 'a',
              assetRevision: 0,
              embeddingId: 'e1',
              snapshotId: 's2',
              similarity: 0.9,
            },
          ],
    }),
  };
  const index = new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
  index.replace('1', []);
  index.semanticFolders = await loadResidentSemanticFolders(db as never, scope, ['one', 'two']);
  const result = withResidentSemanticGraph(index, ['one', 'two', 'one'], (graph) => ({
    score: graph.scores.get('a')?.get(0),
    memberships: graph.context.embeddings.get('a')?.length,
  }));
  assert.deepEqual(result, { score: 0.9, memberships: 2 });
  assert.equal(
    withResidentSemanticGraph(index, ['one'], (graph) => graph.scores.get('a')?.get(0)),
    0.7,
  );
});

test('preparation continues every batch and combines multiple active snapshots of a folder', async () => {
  const previous = process.env.EAGLE_READER_SEMANTIC_BATCH_SIZE;
  process.env.EAGLE_READER_SEMANTIC_BATCH_SIZE = '2';
  const cursors: unknown[][] = [];
  const connection = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM "EagleSmartFolderSemanticSnapshot"'))
        return {
          rows: [
            { id: 's1', folderId: 'folder', ...scope, isActive: true },
            { id: 's2', folderId: 'folder', ...scope, isActive: true },
          ],
        };
      cursors.push(values.slice(3, 5));
      return {
        rows:
          cursors.length === 1
            ? [
                {
                  assetId: 'a',
                  assetRevision: 0,
                  embeddingId: 'e1',
                  snapshotId: 's1',
                  similarity: 0.7,
                },
                {
                  assetId: 'b',
                  assetRevision: 0,
                  embeddingId: 'e2',
                  snapshotId: 's1',
                  similarity: 0.8,
                },
              ]
            : [
                {
                  assetId: 'a',
                  assetRevision: 0,
                  embeddingId: 'e3',
                  snapshotId: 's2',
                  similarity: 0.9,
                },
              ],
      };
    },
  };
  try {
    const graph = (await loadResidentSemanticFolders(connection as never, scope)).get('folder')!;
    assert.deepEqual(cursors, [
      ['', ''],
      ['s1', 'e2'],
    ]);
    assert.equal(graph.scores.size, 2);
    assert.equal(graph.scores.get('a')?.get(0), 0.9);
    assert.equal(graph.context.embeddings.get('a')?.length, 2);
  } finally {
    if (previous === undefined) delete process.env.EAGLE_READER_SEMANTIC_BATCH_SIZE;
    else process.env.EAGLE_READER_SEMANTIC_BATCH_SIZE = previous;
  }
});
