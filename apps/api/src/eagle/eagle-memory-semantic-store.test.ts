import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from './eagle-memory-index';
import { loadResidentSemanticFolders, withResidentSemanticGraph } from './eagle-memory-semantic-store';

const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
function source(abort?: AbortController) {
  let batches = 0;
  let queries = 0;
  return {
    get batches() { return batches; }, get queries() { return queries; },
    query: async (sql: string) => {
      queries++;
      if (sql.includes('FROM "EagleSmartFolderSemanticSnapshot"')) return { rows: [{ id: 'snapshot', folderId: 'folder', ...scope, isActive: true }] };
      if (sql.includes('FROM "EagleSmartFolderSemanticMatch"')) {
        batches++;
        abort?.abort();
        return { rows: [{ assetId: 'a', assetRevision: 0, embeddingId: 'embedding', snapshotId: 'snapshot', similarity: 0.9, ...scope }] };
      }
      return { rows: [] };
    },
  };
}
test('cancelled semantic preparation never publishes partial memberships', async () => {
  const abort = new AbortController();
  const db = source(abort);
  await assert.rejects(loadResidentSemanticFolders(db as never, scope, undefined, abort.signal), /abort/i);
  assert.equal(db.batches, 1);
});
test('repeated semantic reads reuse prepared memberships with no database I/O', async () => {
  const db = source();
  const index = new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
  index.replace('1', []);
  index.semanticFolders = await loadResidentSemanticFolders(db as never, scope);
  const queries = db.queries;
  for (let i = 0; i < 3; i++) {
    const score = withResidentSemanticGraph(index, ['folder'], graph => graph.scores.get('a')?.get(0));
    assert.equal(score, 0.9);
  }
  assert.equal(db.queries, queries);
  const copy = index.snapshot();
  index.semanticFolders = new Map();
  assert.equal(withResidentSemanticGraph(copy, ['folder'], graph => graph.scores.size), 1);
});
