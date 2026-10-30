import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { EagleAssetOperationService } from './eagle-asset-operations.service';

test('a local admission during an empty in-flight claim is followed up without the recovery timer', async () => {
  let release!: () => void;
  let discovered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    discovered = resolve;
  });
  let sends = 0;
  const operation = {
    id: 'operation',
    ownerId: 'owner',
    kind: 'TRASH',
    libraryMode: 'MATERIAL',
    isPrivate: false,
    inputIds: ['asset'],
    items: [],
  };
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    eagleAssetOperation: { findUnique: async () => operation },
    eagleAssetOperationItem: {
      count: async () => 0,
      findFirst: async ({ where }: { where: { operation: { kind: unknown } } }) => {
        if (where.operation.kind === 'SEND' && ++sends === 1) {
          discovered();
          await blocked;
        }
        return null;
      },
    },
  };
  const db = { $transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx) };
  const service = new EagleAssetOperationService(
    db as never,
    undefined as never,
    undefined as never,
  );
  service.onModuleInit();
  const tick = service.tick();
  try {
    await started;
    await service.enqueue({ sub: 'owner', canViewPrivate: false } as never, {
      operationId: 'operation',
      kind: 'TRASH',
      assetIds: ['asset'],
    });
    release();
    await tick;
    await delay(20);
    assert.equal(sends, 2);
  } finally {
    release();
    service.onModuleDestroy();
    await tick;
  }
});

test('idle operation lanes open at most two claim transactions per five seconds and stop on shutdown', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let transactions = 0;
  const db = {
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
  );
  service.onModuleInit();
  try {
    for (let step = 0; step < 20; step++) {
      context.mock.timers.tick(500);
      for (let flush = 0; flush < 10; flush++) await Promise.resolve();
    }
    assert.equal(transactions, 4);
    service.onModuleDestroy();
    context.mock.timers.tick(5000);
    assert.equal(transactions, 4);
  } finally {
    service.onModuleDestroy();
  }
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
  );
  service.tick = async () => {
    assert.ok(committed);
    wakeups++;
  };
  service.onModuleInit();
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
