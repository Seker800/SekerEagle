import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleDuplicateService } from './eagle-duplicates.service';

for (const kind of ['scan', 'cleanup'] as const) {
  test(`${kind} persists discovery intent without taking the busy privacy lock or reading the library`, async () => {
    const items: Array<{ snapshots: { kind: string } }> = [];
    const tx = {
      $queryRaw: async (sql: unknown) => {
        assert.ok(!JSON.stringify(sql).includes('sekereagle:privacy'), 'HTTP must not wait on the domain lock');
        return [];
      },
      eagleAssetOperation: { findUnique: async () => null, findFirst: async () => null, create: async () => ({}) },
      eagleAssetOperationItem: { createMany: async ({ data }: { data: typeof items }) => { items.push(...data); return { count: data.length }; } },
    };
    const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx) };
    const service = new EagleDuplicateService(db as never, undefined as never, 'MATERIAL');
    const principal = { sub: 'owner', authVersion: 0, canViewPrivate: false } as never;
    const result = kind === 'scan' ? await service.scan(principal, 'intent') : await service.cleanup(principal, { operationId: 'intent', groups: [{ signature: 'reviewed-group', keepIds: ['keep'] }] });
    assert.equal(result.operationId, 'intent');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.snapshots.kind, kind === 'scan' ? 'discover' : 'prepare-cleanup');
  });
}
