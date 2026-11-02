import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleAssetOperationService } from './eagle-asset-operations.service';

test('cancel persists operation intent before cancelling pending items so claimed expansion cannot escape it', async () => {
  const events: string[] = [];
  const operation = {
    id: 'operation',
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    kind: 'DUPLICATE_SCAN',
    isPrivate: false,
    items: [{ status: 'RUNNING', weight: 1, errorCode: null }],
  };
  const tx = {
    $queryRaw: async () => [],
    eagleAssetOperation: {
      findFirst: async () => operation,
      update: async ({ data }: { data: { cancelRequestedAt?: Date } }) => {
        assert.ok(data.cancelRequestedAt instanceof Date);
        events.push('intent');
      },
    },
    eagleAssetOperationItem: {
      updateMany: async () => {
        events.push('items');
        return { count: 0 };
      },
    },
  };
  const service = new EagleAssetOperationService(
    { $transaction: async (work: (db: typeof tx) => Promise<unknown>) => work(tx) } as never,
    undefined as never,
    undefined as never,
    'MATERIAL',
  );
  await service.cancel({ sub: 'owner', canViewPrivate: false } as never, 'operation');
  assert.deepEqual(events, ['intent', 'items']);
});

test('a claimed operation cancelled before publication cannot publish new domain facts', async () => {
  const tx = {
    $queryRaw: async () => [{ cancelled: true }],
    user: { findUnique: async () => ({ authVersion: 0, disabledAt: null }) },
    eagleAssetOperationItem: { updateMany: async () => ({ count: 1 }) },
  };
  const service = new EagleAssetOperationService(
    {} as never,
    undefined as never,
    undefined as never,
    'MATERIAL',
  );
  const executor = service as unknown as {
    assertActor: (db: unknown, operation: unknown, items: unknown[]) => Promise<void>;
  };
  await assert.rejects(
    executor.assertActor(
      tx,
      { id: 'operation', ownerId: 'owner', authVersion: 0, isPrivate: false },
      [{ id: 'item', operationId: 'operation', leaseVersion: 1 }],
    ),
    (error: unknown) => error instanceof Error && error.message === 'OPERATION_CANCELLED',
  );
});

test('cancel between rollback and conflict splitting records CANCELLED without escaping or repeating the mutation', async () => {
  const { OperationCancelledError } = await import('./eagle-operation-cancellation');
  const { ConflictException } = await import('@nestjs/common');
  const terminal: unknown[] = [];
  let publications = 0,
    splits = 0;
  const service = new EagleAssetOperationService(
    {
      eagleAssetOperationItem: {
        updateMany: async ({ data }: { data: unknown }) => {
          terminal.push(data);
          return { count: 1 };
        },
      },
    } as never,
    undefined as never,
    undefined as never,
    'MATERIAL',
  );
  Object.assign(service, {
    publishMetadataBatch: async () => {
      publications++;
      throw new ConflictException('rolled back');
    },
    splitLibraryCommand: async () => {
      splits++;
      throw new OperationCancelledError();
    },
  });
  const execute = service as unknown as { execute: (items: unknown[]) => Promise<void> };
  await execute.execute([
    {
      id: 'item',
      operationId: 'operation',
      ownerId: 'owner',
      libraryMode: 'MATERIAL',
      assetIds: ['one', 'two'],
      leaseVersion: 1,
      operation: { id: 'operation', ownerId: 'owner', kind: 'METADATA_COMMAND' },
    },
  ]);
  assert.equal(publications, 1);
  assert.equal(splits, 1);
  assert.deepEqual(terminal, [{ status: 'CANCELLED', errorCode: null, leaseUntil: null }]);
});

test('stopping a SEND preserves publication of already claimed copies while retaining actor and lease checks', async () => {
  let leaseChecks = 0;
  const tx = {
    $queryRaw: async () => [{ cancelled: true }],
    user: { findUnique: async () => ({ authVersion: 0, disabledAt: null }) },
    eagleAssetOperationItem: {
      updateMany: async () => {
        leaseChecks++;
        return { count: 1 };
      },
    },
  };
  const service = new EagleAssetOperationService(
    {} as never,
    undefined as never,
    undefined as never,
    'PHOTO',
  );
  const executor = service as unknown as {
    assertActor: (db: unknown, operation: unknown, items: unknown[]) => Promise<void>;
  };
  await executor.assertActor(
    tx,
    { id: 'operation', ownerId: 'owner', kind: 'SEND', authVersion: 0, isPrivate: false },
    [{ id: 'copying', operationId: 'operation', leaseVersion: 1 }],
  );
  assert.equal(leaseChecks, 1);
});
