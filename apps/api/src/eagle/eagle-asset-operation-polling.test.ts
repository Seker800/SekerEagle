import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleAssetOperationService } from './eagle-asset-operations.service';

test('idle operation lanes avoid claim transactions when unlocked probes are empty and stop on shutdown', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let transactions = 0;
  let probes = 0;
  const db = {
    eagleAssetOperationItem: { findFirst: async () => { probes++; return null; } },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      transactions++;
      return run({
        $executeRaw: async () => 0,
        eagleAssetOperationItem: {
          count: async () => 0,
          findFirst: async () => null,
        },
      });
    },
  };
  const service = new EagleAssetOperationService(
    db as never,
    undefined as never,
    undefined as never,
    'MATERIAL',
  );
  service.startExecutor();
  try {
    for (let step = 0; step < 20; step++) {
      context.mock.timers.tick(500);
      for (let flush = 0; flush < 10; flush++) await Promise.resolve();
    }
    assert.equal(transactions, 0);
    assert.ok(probes > 0 && probes <= 12, 'idle backoff must actually probe without spinning');
    service.onModuleDestroy();
    context.mock.timers.tick(5000);
    assert.equal(transactions, 0);
  } finally {
    service.onModuleDestroy();
  }
});

test('recovery timer waits for the previous check to finish', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const service = new EagleAssetOperationService({} as never, undefined as never, undefined as never, 'PHOTO');
  let checks = 0, complete!: () => void;
  service.tick = async () => { checks++; await new Promise<void>((resolve) => { complete=resolve; }); };
  service.startExecutor();
  try {
    context.mock.timers.tick(1000);
    assert.equal(checks,1);
    context.mock.timers.tick(10_000);
    assert.equal(checks,1);
  } finally { service.onModuleDestroy(); complete(); }
});

test('accepted and retried commands wake the local processor only after commit', async () => {
  const operation = {
    id: 'operation',
    ownerId: 'owner',
    kind: 'TRASH',
    libraryMode: 'MATERIAL',
    isPrivate: false,
    inputIds: ['asset'],
    items: [],
  };
  let committed = false;
  let wakeups = 0;
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    eagleAssetOperation: {
      findUnique: async () => operation,
      findFirst: async () => operation,
      update: async () => operation,
    },
    eagleAssetOperationItem: { updateMany: async () => ({ count: 0 }) },
  };
  const db = {
    $transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      const value = await run(tx);
      committed = true;
      return value;
    },
  };
  const service = new EagleAssetOperationService(
    db as never,
    undefined as never,
    undefined as never,
    'MATERIAL',
  );
  service.tick = async () => {
    assert.ok(committed);
    wakeups++;
  };
  service.startExecutor();
  try {
    const principal = { sub: 'owner', canViewPrivate: false } as never;
    await service.enqueue(principal, {
      operationId: 'operation',
      kind: 'TRASH',
      assetIds: ['asset'],
    });
    assert.equal(wakeups, 1);
    committed = false;
    await service.retry(principal, 'operation');
    assert.equal(wakeups, 2);
  } finally {
    service.onModuleDestroy();
  }
});
