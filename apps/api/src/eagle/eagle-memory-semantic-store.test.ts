import type { LibraryReadStore } from './eagle-memory-store';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from './eagle-memory-index';
import { withResidentSemanticGraph } from './eagle-memory-semantic-store';

test('a cancelled semantic request stops before reading its next database batch', async () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', []);
  const abort = new AbortController();
  let batches = 0;
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
      return { rows: [] };
    },
    release: () => {},
  };
  const source: Pick<LibraryReadStore, 'readSnapshot'> = {
    readSnapshot: async (_scope, read) => read(connection as never, index.snapshot()),
  };
  await assert.rejects(
    withResidentSemanticGraph(source, index, ['folder'], () => [], 134217728, abort.signal),
    /abort/i,
  );
  assert.equal(batches, 1);
});

test('unrelated index publication during semantic database I/O does not discard a valid read epoch', async () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  const row = {
    id: 'a',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    rating: 4,
    libraryAddedAt: new Date(0),
    chronologicalAt: new Date(0),
  };
  index.replace('1', [row]);
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
        index.update('2', ['a'], [{ ...row, rating: 1 }]);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const source: Pick<LibraryReadStore, 'readSnapshot'> = {
    readSnapshot: async (_scope, read) => read(connection as never, index.snapshot()),
  };
  const result = await withResidentSemanticGraph(source, index, ['folder'], (_graph, snapshot) => ({
    revision: snapshot.revision,
    count: snapshot.count({ rating: 4 }),
  }));
  assert.deepEqual(result, { revision: '1', count: 1 });
  assert.equal(index.count({ rating: 4 }), 0);
});
