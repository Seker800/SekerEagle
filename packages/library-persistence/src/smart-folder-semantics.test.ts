import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scheduleSmartFolderSnapshot,
  smartFolderMatchWhere,
  matchSmartFoldersForEmbedding,
} from './smart-folder-semantics';

const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
function fixture(current?: { id: string; status: string }) {
  const deleted: unknown[] = [],
    created: Array<{ data: Record<string, unknown> }> = [],
    queries: PrismaSql[] = [];
  const tx = {
    $queryRaw: async (sql: PrismaSql) => {
      queries.push(sql);
      return [];
    },
    $executeRaw: async (sql: PrismaSql) => {
      queries.push(sql);
      return 1;
    },
    eagleSmartFolderSemanticSnapshot: {
      findFirst: async () => current,
      deleteMany: async (input: unknown) => {
        deleted.push(input);
        return { count: 0 };
      },
      create: async (input: { data: Record<string, unknown> }) => {
        created.push(input);
        return input.data;
      },
    },
  };
  return { tx, deleted, created, queries };
}
interface PrismaSql {
  strings: readonly string[];
  values: unknown[];
}

test('saving an unchanged intent preserves the durable vector and cancels obsolete pending work', async () => {
  const f = fixture({ id: 'active', status: 'READY' });
  await scheduleSmartFolderSnapshot(
    f.tx as never,
    scope,
    'folder',
    { text: '海边', breadth: 'BALANCED' },
    'space',
    0.3,
  );
  assert.equal(f.created.length, 0);
  assert.deepEqual(f.deleted[0], {
    where: { ...scope, folderId: 'folder', isActive: false, id: { not: 'active' } },
  });
});

test('new or failed intents enqueue fresh snapshots without deleting active results', async () => {
  for (const current of [undefined, { id: 'failed', status: 'FAILED' }]) {
    const f = fixture(current);
    await scheduleSmartFolderSnapshot(
      f.tx as never,
      scope,
      'folder',
      { text: '海边', breadth: 'STRICT' },
      'space',
      0.35,
    );
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.deleted[0], { where: { ...scope, folderId: 'folder', isActive: false } });
    assert.equal(f.created[0]!.data.ownerId, scope.ownerId);
    assert.equal(f.created[0]!.data.libraryMode, 'PHOTO');
    assert.equal(f.created[0]!.data.threshold, 0.35);
  }
});

test('removing semantic intent deletes all scoped snapshots and their cascading matches', async () => {
  const f = fixture();
  await scheduleSmartFolderSnapshot(f.tx as never, scope, 'folder', undefined, 'space');
  assert.deepEqual(f.deleted, [{ where: { ...scope, folderId: 'folder' } }]);
  assert.equal(f.created.length, 0);
});

test('matching uses only one published embedding and current media versions in the same owner/mode/space', async () => {
  const f = fixture();
  await matchSmartFoldersForEmbedding(f.tx as never, scope, 'embedding');
  const sql = f.queries.at(-1)!;
  const text = sql.strings.join('?');
  assert.match(text, /a\."mediaRevision"=e\."assetRevision"/);
  assert.match(text, /s\."spaceId"=e\."spaceId"/);
  assert.match(text, /s\."isActive" OR s.status='BUILDING'/);
  assert.match(text, /ON CONFLICT/);
  assert.deepEqual(sql.values, ['embedding', 'owner', 'PHOTO']);
  assert.deepEqual(smartFolderMatchWhere(scope, 'folder'), {
    embeddings: {
      some: {
        ...scope,
        smartFolderMatches: {
          some: { ...scope, snapshot: { ...scope, folderId: 'folder', isActive: true } },
        },
      },
    },
  });
});

test('folder metadata cannot override snapshot identity or leak into scoped predicates', async () => {
  const f = fixture();
  const folder = { ...scope, id: 'folder-id' };
  await scheduleSmartFolderSnapshot(
    f.tx as never,
    folder,
    folder.id,
    { text: '海边', breadth: 'STRICT' },
    'space',
    0.35,
  );
  assert.equal(
    f.created[0]!.data.id,
    undefined,
    'the snapshot must have its own generated identity',
  );
  assert.deepEqual(f.deleted[0], { where: { ...scope, folderId: folder.id, isActive: false } });
  assert.deepEqual(
    smartFolderMatchWhere(folder, folder.id),
    smartFolderMatchWhere(scope, folder.id),
  );
});
