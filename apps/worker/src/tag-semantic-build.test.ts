import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrototypePlan, parsePgVector } from './tag-semantic-build';

test('parsePgVector accepts canonical pgvector text and rejects malformed values', () => {
  assert.deepEqual(parsePgVector('[0.6,0.8]', 2), [0.6, 0.8]);
  assert.throws(() => parsePgVector('[0.6,NaN]', 2), /finite/i);
  assert.throws(() => parsePgVector('[1]', 2), /dimension/i);
});

test('buildPrototypePlan produces weighted multi-centers and representative evidence', () => {
  const plan = buildPrototypePlan(
    [
      { assetId: 'a', embedding: [1, 0] },
      { assetId: 'b', embedding: [0.99, 0.01] },
      { assetId: 'c', embedding: [0, 1] },
      { assetId: 'd', embedding: [0.01, 0.99] },
    ],
    { minimumRelativeImprovement: 0.5 },
  );
  assert.equal(plan.prototypes.length, 2);
  assert.equal(
    plan.prototypes.reduce((sum: number, item: { memberCount: number }) => sum + item.memberCount, 0),
    4,
  );
  assert.ok(
    Math.abs(
      plan.prototypes.reduce((sum: number, item: { weight: number }) => sum + item.weight, 0) - 1,
    ) < 1e-9,
  );
  assert.equal(
    plan.prototypes.every(
      (item: { representativeAssetIds: string[] }) => item.representativeAssetIds.length > 0,
    ),
    true,
  );
});
