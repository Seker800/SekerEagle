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
