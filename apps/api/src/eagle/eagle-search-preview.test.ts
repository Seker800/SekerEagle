import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleImageSearch } from './eagle-search-preview';

test('sampled previews set local iterative HNSW options and sort ties only after the index boundary', async () => {
  const statements: string[] = [];
  const tx = {
    $executeRaw: async (q: { sql: string }) => {
      statements.push(q.sql);
      return 1;
    },
    $queryRaw: async (q: { sql: string }) => {
      statements.push(q.sql);
      return [];
    },
  };
  await sampleImageSearch(
    { $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    { ownerId: 'owner', libraryMode: 'PHOTO' },
    { status: 'READY', spaceId: 'space', vector: '[1,0]' },
    0.25,
    false,
  );
  assert.ok(statements.some((q) => q.includes('hnsw.ef_search')));
  assert.ok(statements.some((q) => q.includes('hnsw.iterative_scan')));
  const sql = statements.at(-1)!;
  assert.match(sql, /AS MATERIALIZED/);
  assert.match(sql, /ORDER BY e.embedding <=> \?::vector LIMIT 100/);
  assert.match(sql, /WHERE distance<=/);
  assert.match(sql, /NOT a."isPrivate"/);
});

test('invalid preview resource budgets fail before opening a database transaction', async () => {
  for (const [name, value] of [
    ['EAGLE_IMAGE_SEARCH_PREVIEW_EF_SEARCH', '1001'],
    ['EAGLE_IMAGE_SEARCH_PREVIEW_SCAN_TUPLES', '0'],
    ['EAGLE_IMAGE_SEARCH_PREVIEW_TIMEOUT_MS', 'invalid'],
  ]) {
    const previous = process.env[name!];
    process.env[name!] = value;
    try {
      await assert.rejects(
        sampleImageSearch(
          {
            $transaction: () => assert.fail('invalid settings must not reach the database'),
          } as never,
          { ownerId: 'owner', libraryMode: 'MATERIAL' },
          { status: 'READY', spaceId: 'space', vector: '[1,0]' },
          0.25,
          true,
        ),
        new RegExp(`Invalid ${name}`),
      );
    } finally {
      if (previous === undefined) delete process.env[name!];
      else process.env[name!] = previous;
    }
  }
});
