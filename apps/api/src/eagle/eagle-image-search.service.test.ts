import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleImageSearchService } from './eagle-image-search.service';
const space = {
  id: 'qwen3-vl-embedding-2b-1024-v1',
  isCurrent: true,
  model: 'Qwen/Qwen3-VL-Embedding-2B',
  revision: '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda',
  dimensions: 1024,
  normalized: true,
  instructionVersion: 'image-retrieval-v1',
  preprocessingVersion: 'preview-webp-v1',
};
test('image search caches/coalesces text vectors and scopes them by owner and mode', async () => {
  let calls = 0;
  const service = new EagleImageSearchService(
    { eagleEmbeddingSpace: { findUnique: async () => space } } as never,
    {
      embedText: async () => {
        calls++;
        return {
          embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
          revision: space.revision,
        };
      },
    } as never,
  );
  await Promise.all([service.prepare('one', '猫'), service.prepare('one', '猫')]);
  assert.equal(calls, 1);
  await service.prepare('two', '猫');
  assert.equal(calls, 2);
});
test('mismatched image space and unavailable model degrade explicitly without reembedding images', async () => {
  let calls = 0;
  const service = new EagleImageSearchService(
    { eagleEmbeddingSpace: { findUnique: async () => ({ ...space, revision: 'wrong' }) } } as never,
    {
      embedText: async () => {
        calls++;
        throw new Error('offline');
      },
    } as never,
  );
  assert.equal((await service.prepare('one', '猫')).status, 'UNAVAILABLE');
  assert.equal(calls, 0);
});
test('ranking queries current image embeddings and never traverses AI tag links', async () => {
  let sql = '';
  const service = new EagleImageSearchService(
    {
      $queryRaw: async (query: unknown) => {
        sql = JSON.stringify(query);
        return [
          { assetId: 'one', tier: 1, similarity: 0.9, libraryAddedAt: new Date('2026-01-01') },
        ];
      },
    } as never,
    {} as never,
  );
  const result = await service.rankPage(
    'owner',
    '猫',
    { status: 'READY', spaceId: space.id, vector: '[1,0]' },
    undefined,
    40,
    false,
    false,
  );
  assert.deepEqual(
    result.map((row) => row.assetId),
    ['one'],
  );
  assert.doesNotMatch(sql, /OFFSET/);
  assert.match(sql, /EagleAssetEmbedding/);
  assert.match(sql, /assetRevision/);
  assert.match(sql, /mediaRevision/);
  assert.match(sql, /isCurrent/);
  assert.match(sql, /READY/);
  assert.match(sql, /libraryMode/);
  assert.match(sql, /isPrivate/);
  assert.doesNotMatch(sql, /EagleAssetAiTag|EagleAiTag/);
});

test('embedding client refuses unversioned or incompatible model output', async () => {
  const { EagleEmbeddingClient } = await import('./eagle-embedding-client');
  const originalFetch = globalThis.fetch,
    oldUrl = process.env.MLX_EMBEDDING_URL,
    oldToken = process.env.MLX_EMBEDDING_TOKEN;
  process.env.MLX_EMBEDDING_URL = 'http://127.0.0.1:11435';
  process.env.MLX_EMBEDDING_TOKEN = 'test-only';
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: space.model,
          dimensions: 1024,
          normalized: true,
          embedding: Array(1024).fill(0),
        }),
        { status: 200 },
      );
    await assert.rejects(() => new EagleEmbeddingClient().embedText('test'), /CONTRACT_DRIFT/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.MLX_EMBEDDING_URL;
    else process.env.MLX_EMBEDDING_URL = oldUrl;
    if (oldToken === undefined) delete process.env.MLX_EMBEDDING_TOKEN;
    else process.env.MLX_EMBEDDING_TOKEN = oldToken;
  }
});

test('explicit search date order uses date and ID for both ORDER BY and continuation', async () => {
  for (const sort of ['CAPTURED_AT', 'ADDED_AT'] as const) {
    let sql = '';
    const service = new EagleImageSearchService(
      {
        $queryRaw: async (q: { sql: string }) => {
          sql = q.sql;
          return [];
        },
      } as never,
      {} as never,
    );
    await service.rankPage(
      'owner',
      '猫',
      { status: 'UNAVAILABLE', spaceId: 'test' },
      { assetId: 'last', tier: 5, similarity: 1, libraryAddedAt: '2026-10-01T00:00:00Z' },
      60,
      false,
      false,
      undefined,
      sort,
    );
    const field = sort === 'CAPTURED_AT' ? 'chronologicalAt' : 'libraryAddedAt';
    assert.ok(sql.includes(`ORDER BY asset."${field}" DESC,ranked."assetId" DESC`));
    assert.ok(sql.includes(`WHERE (asset."${field}", ranked."assetId") <`));
    assert.ok(sql.includes(`asset."${field}" AS "libraryAddedAt"`));
    assert.ok(sql.includes('asset."ownerId"='));
    assert.ok(sql.includes('asset."libraryMode"='));
    assert.ok(sql.includes('asset."isPrivate"=false'));
  }
});
