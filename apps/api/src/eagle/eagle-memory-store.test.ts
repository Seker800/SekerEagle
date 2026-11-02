import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { LibraryReadStore, readMemoryAssets } from './eagle-memory-store';

const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
const asset = (rating: number, isPrivate = false) => ({
  ...scope,
  id: 'a',
  rating,
  isPrivate,
  deletedAt: null,
  mediaRevision: 0,
  libraryAddedAt: new Date(0),
  chronologicalAt: new Date(0),
});
function database() {
  let revision = 1;
  let blockNext = false;
  let unblock = () => {};
  let entered = () => {};
  let started = Promise.resolve();
  let reads = 0;
  let sources: string[] = [];
  const statements: string[] = [];
  const query = async (sql: string) => {
    reads++;
    statements.push(sql);
    if (sql.startsWith('SELECT revision,enabled'))
      return { rows: [{ revision: String(revision), enabled: true }] };
    if (sql.includes('SELECT revision,rebuild'))
      return { rows: [{ revision: '2', rebuild: false, assetIds: ['a'], folderIds: [], sources }] };
    if (sql.includes('FROM "EagleAsset" a WHERE')) {
      const row = asset(revision, revision === 2);
      if (blockNext) {
        blockNext = false;
        entered();
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
      }
      return { rows: [row] };
    }
    return { rows: [] };
  };
  return {
    pool: { query, connect: async () => ({ query, release() {} }) } as unknown as Pool,
    get reads() {
      return reads;
    },
    change(tables: string[] = []) {
      revision = 2;
      sources = tables;
    },
    statements,
    block() {
      blockNext = true;
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    },
    started: () => started,
    release: () => unblock(),
  };
}

test('a hot resident read uses only the commit revision fence and does not copy its index', async () => {
  const db = database();
  const store = new LibraryReadStore(db.pool);
  const index = await store.synchronize(scope);
  const before = db.reads;
  assert.equal(await store.read(scope), index);
  assert.equal(db.reads - before, 1);
});

test('foreground changes publish independently of a blocked background refresh', async () => {
  const db = database();
  const store = new LibraryReadStore(db.pool);
  const old = await store.synchronize(scope);
  db.change();
  db.block();
  const background = store.synchronize(scope);
  await db.started();
  try {
    const current = await Promise.race([
      store.read(scope),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('foreground waited for background')), 500),
      ),
    ]);
    assert.equal(current.count({ rating: 2, isPrivate: true }), 1);
    assert.equal(current.count({ isPrivate: false }), 0);
    assert.equal(old.count({ rating: 1, isPrivate: false }), 1);
  } finally {
    db.release();
    await background;
  }
});

test('incremental relation queries constrain their own owner, mode and asset keys', async () => {
  const statements: string[] = [];
  await readMemoryAssets(
    {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [] };
      },
    } as never,
    scope,
    ['a'],
  );
  for (const sql of statements.filter((sql) =>
    /FROM "EagleAssetAiTag"|FROM "EaglePhotoFace"|FROM "EagleAssetColorAnalysis"/.test(sql),
  )) {
    assert.match(sql, /c\."ownerId"=/);
    assert.match(sql, /c\."libraryMode"=/);
    assert.match(sql, /c\."assetId"/);
  }
});


test('a color-only commit refreshes colors without rereading tags, people or base assets', async () => {
  const db = database();
  const store = new LibraryReadStore(db.pool);
  await store.synchronize(scope);
  db.change(['EagleAssetColorAnalysis', 'EagleAssetColorSwatch']);
  const before = db.statements.length;
  const current = await store.read(scope);
  const queries = db.statements.slice(before);
  assert.ok(queries.some(sql => sql.includes('FROM "EagleAssetColorAnalysis"')));
  assert.ok(!queries.some(sql => sql.includes('FROM "EagleAssetAiTag"')));
  assert.ok(!queries.some(sql => sql.includes('FROM "EaglePhotoFace"')));
  assert.ok(!queries.some(sql => sql.includes('FROM "EagleAsset" a WHERE')));
  assert.equal(current.count({ rating: 1 }), 1);
});
