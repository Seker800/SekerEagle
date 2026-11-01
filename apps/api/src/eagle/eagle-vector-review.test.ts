import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleVectorService } from './eagle-vector.service';

test('review counters read saved suggestions without querying model health or processing', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('model offline');
  });
  const scopes: unknown[] = [];
  const service = new EagleVectorService(
    {
      eagleAsset: {
        count: async (input: unknown) => {
          scopes.push(input);
          return 9;
        },
      },
      eagleVectorTagSuggestion: {
        count: async (input: unknown) => {
          scopes.push(input);
          return 4;
        },
      },
    } as never,
    'PHOTO',
  );
  const result = await service.reviewSummary('owner', false);
  assert.deepEqual(result, { suggestions: { unclassified: 9, pending: 4 } });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(scopes.length, 2);
  for (const scope of scopes) {
    assert.match(JSON.stringify(scope), /owner/);
    assert.match(JSON.stringify(scope), /PHOTO/);
    assert.match(JSON.stringify(scope), /isPrivate/);
  }
});

test('rejecting forty saved suggestions uses one transaction and one status write', async () => {
  let transactions = 0,
    writes = 0;
  const rows = Array.from({ length: 40 }, (_, n) => ({
    id: `suggestion-${n}`,
    assetId: `asset-${n}`,
    status: 'PENDING',
    isActive: true,
    invalidatedAt: null,
  }));
  const tx = {
    eagleVectorTagSuggestion: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id),
      findMany: async () => rows,
      updateMany: async ({ where }: { where: { id: string | { in: string[] } } }) => {
        writes++;
        return { count: typeof where.id === 'string' ? 1 : where.id.in.length };
      },
    },
  };
  const service = new EagleVectorService(
    {
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        transactions++;
        return work(tx);
      },
    } as never,
    'MATERIAL',
  );
  const result = await service.reviewSuggestions(
    'owner',
    rows.map((r) => r.id),
    'REJECT',
  );
  assert.equal(result.items.length, 40);
  assert.equal(transactions, 1);
  assert.equal(writes, 1);
});

test('stored vector progress uses worker observations while the model is unreachable', async t => {
  const oldUrl = process.env.MLX_EMBEDDING_URL, oldToken = process.env.MLX_EMBEDDING_TOKEN;
  process.env.MLX_EMBEDDING_URL = 'http://127.0.0.1:1'; process.env.MLX_EMBEDDING_TOKEN = 'synthetic';
  t.after(() => { if (oldUrl === undefined) delete process.env.MLX_EMBEDDING_URL; else process.env.MLX_EMBEDDING_URL = oldUrl; if (oldToken === undefined) delete process.env.MLX_EMBEDDING_TOKEN; else process.env.MLX_EMBEDDING_TOKEN = oldToken; });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('model offline'); });
  const service = new EagleVectorService({
    eagleAsset: { count: async () => 0 }, eagleAssetEmbedding: { count: async () => 0 },
    eagleManualTagSemanticConfig: { count: async () => 0 }, eagleVectorTagSuggestion: { count: async () => 0 },
    eagleAssetProcessingJob: { groupBy: async () => [] }, eagleProcessingSetting: { findUnique: async () => null },
    eagleProcessingWorkerHeartbeat: { findFirst: async () => ({ heartbeatAt: new Date(), capabilities: { embedding: 'READY' } }) },
    $queryRaw: async () => [{ count: 0 }],
  } as never, 'MATERIAL');
  const summary = await service.summary('owner');
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(summary.host.status, 'ONLINE');
});
