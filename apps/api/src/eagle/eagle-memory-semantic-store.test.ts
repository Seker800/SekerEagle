import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from './eagle-memory-index';
import { withResidentSemanticGraph } from './eagle-memory-semantic-store';

test('a cancelled semantic request stops before reading its next database batch', async () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', []);
  const abort = new AbortController();
  let batches = 0,
    released = false,
    rolledBack = false;
  const connection = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT revision')) return { rows: [{ revision: '1' }] };
      if (sql.includes('FROM "EagleSmartFolderSemanticSnapshot"'))
        return {
          rows: [
            {
              id: 'snapshot',
              folderId: 'folder',
              ownerId: 'owner',
              libraryMode: 'PHOTO',
              isActive: true,
            },
          ],
        };
      if (sql.includes('FROM "EagleSmartFolderSemanticMatch"')) {
        batches++;
        abort.abort();
        return {
          rows: Array.from({ length: 2048 }, (_, at) => ({
            assetId: String(at),
            assetRevision: 0,
            embeddingId: String(at),
            snapshotId: 'snapshot',
            similarity: 0.9,
          })),
        };
      }
      if (sql === 'ROLLBACK') rolledBack = true;
      return { rows: [] };
    },
    release: () => {
      released = true;
    },
  };
  await assert.rejects(
    withResidentSemanticGraph(
      { connect: async () => connection } as never,
      index,
      ['folder'],
      () => [],
      134217728,
      abort.signal,
    ),
    /abort/i,
  );
  assert.equal(batches, 1);
  assert.ok(released);
  assert.ok(rolledBack);
});

test('unrelated index publication during semantic database I/O does not discard a valid read epoch', async () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  const row = { id: 'a', ownerId: 'owner', libraryMode: 'PHOTO', rating: 4,
    libraryAddedAt: new Date(0), chronologicalAt: new Date(0) };
  index.replace('1', [row]);
  const connection = { query: async (sql: string) => {
    if (sql.startsWith('SELECT revision')) return { rows: [{ revision: '1' }] };
    if (sql.includes('FROM "EagleSmartFolderSemanticSnapshot"')) return { rows: [{ id: 'snapshot', folderId: 'folder', ownerId: 'owner', libraryMode: 'PHOTO', isActive: true }] };
    if (sql.includes('FROM "EagleSmartFolderSemanticMatch"')) {
      index.update('2', ['a'], [{ ...row, rating: 0 }]);
      return { rows: [] };
    }
    return { rows: [] };
  }, release: () => {} };
  const result = await withResidentSemanticGraph({ connect: async () => connection } as never,
    index, ['folder'], (_graph, snapshot) => ({ revision: snapshot.revision, count: snapshot.count({ rating: 4 }) }));
  assert.deepEqual(result, { revision: '1', count: 1 });
  assert.equal(index.count({ rating: 4 }), 0);
});
