import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import type { AuthPrincipal } from '../auth/auth.types';
import { EagleController } from './eagle.controller';
import { SendEagleAssetsDto } from './eagle.dto';
import { EnqueueAssetOperationDto } from './eagle-asset-operations.dto';
import { EagleAssetOperationService } from './eagle-asset-operations.service';
import { PhotosController } from '../photos/photo-library.module';
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const input = () => ({ operationId: randomUUID(), kind: 'SEND', assetIds: [randomUUID()] });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: EnqueueAssetOperationDto });
test('queue command validation rejects owner, mode, private escalation, unknown actions and invalid IDs', async () => {
  await validate(input());
  for (const extra of [
    { ownerId: randomUUID() },
    { libraryMode: 'PHOTO' },
    { isPrivate: true },
    { authVersion: 4 },
    { kind: 'PURGE' },
    { operationId: 'invalid' },
    { assetIds: ['invalid'] },
  ])
    await assert.rejects(validate({ ...input(), ...extra }));
  const duplicate = randomUUID();
  await validate({ ...input(), assetIds: [duplicate, duplicate] });
});
test('a queue command accepts a large unique selection instead of imposing a 1000 item user limit', async () => {
  const assetIds = Array.from({ length: 5001 }, () => randomUUID());
  const result = await validate({ ...input(), assetIds });
  assert.equal(result.assetIds.length, 5001);
});
test('both inherited controllers require authenticated browser principals and origin validation on every mutation', () => {
  for (const controller of [EagleController, PhotosController]) {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
    assert.ok(guards.includes(AccessAuthGuard));
    assert.ok(guards.includes(BrowserPrincipalGuard));
    for (const name of ['enqueueOperation', 'retryOperation', 'cancelOperation'] as const)
      assert.ok(
        (
          Reflect.getMetadata(
            GUARDS_METADATA,
            Reflect.get(controller.prototype, name) as object,
          ) as unknown[]
        ).includes(BrowserOriginGuard),
      );
  }
});
test('principal controls owner and private visibility; publicOnly can only restrict it', async () => {
  const calls: unknown[] = [];
  const operations = {
    list: (...args: unknown[]) => calls.push(args),
    enqueue: (...args: unknown[]) => calls.push(args),
    retry: (...args: unknown[]) => calls.push(args),
    cancel: (...args: unknown[]) => calls.push(args),
  };
  const controller = new EagleController(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined,
    operations as never,
  );
  const principal = { sub: 'owner', canViewPrivate: false } as AuthPrincipal;
  controller.listOperations(principal, { publicOnly: 'false' });
  controller.listOperations({ ...principal, canViewPrivate: true }, { publicOnly: 'true' });
  controller.listOperations({ ...principal, canViewPrivate: true }, {});
  const command = input();
  controller.enqueueOperation(principal, command as never);
  controller.retryOperation(principal, 'operation');
  controller.cancelOperation(principal, 'operation');
  assert.deepEqual(calls, [
    ['owner', false],
    ['owner', false],
    ['owner', true],
    [principal, command],
    [principal, 'operation'],
    [principal, 'operation'],
  ]);
});

test('idle operation polling uses bounded unlocked probes and opens no claim transactions', async () => {
  const probes: unknown[] = [];
  let transactions = 0;
  const service = new EagleAssetOperationService(
    {
      eagleAssetOperationItem: {
        findFirst: async (args: unknown) => {
          probes.push(args);
          return null;
        },
      },
      $transaction: async () => {
        transactions++;
        return [];
      },
    } as never,
    {} as never,
    {} as never,
  );
  await service.tick();
  assert.equal(probes.length, 2);
  assert.equal(transactions, 0);
  for (const probe of probes) assert.deepEqual((probe as { select: unknown }).select, { id: true });
});

test('a command committed during an empty probe is picked up without waiting for the idle interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let resolveProbe!: (value: null) => void;
  const firstProbe = new Promise<null>((resolve) => {
    resolveProbe = resolve;
  });
  let sendProbes = 0;
  const item = { status: 'PENDING', weight: 1, errorCode: null };
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eagleAssetOperation: {
      findUnique: async () => ({
        id: 'operation',
        ownerId: 'owner',
        libraryMode: 'MATERIAL',
        kind: 'SEND',
        isPrivate: false,
        inputIds: ['asset'],
        items: [item],
      }),
    },
  };
  const service = new EagleAssetOperationService(
    {
      eagleAssetOperationItem: {
        findFirst: async (args: { where: { operation: { kind: unknown } } }) => {
          if (args.where.operation.kind === 'SEND') {
            sendProbes++;
            if (sendProbes === 1) return firstProbe;
          }
          return null;
        },
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx),
    } as never,
    {} as never,
    {} as never,
  );
  const prior = process.env.EAGLE_ASSET_OPERATIONS_ENABLED;
  process.env.EAGLE_ASSET_OPERATIONS_ENABLED = 'true';
  try {
    service.startExecutor();
    const polling = service.tick();
    await service.enqueue({ sub: 'owner', canViewPrivate: false } as never, {
      operationId: 'operation',
      kind: 'SEND',
      assetIds: ['asset'],
    });
    resolveProbe(null);
    await polling;
    t.mock.timers.tick(0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sendProbes, 2, 'the committed wake must survive an in-flight empty probe');
  } finally {
    service.onModuleDestroy();
    if (prior === undefined) delete process.env.EAGLE_ASSET_OPERATIONS_ENABLED;
    else process.env.EAGLE_ASSET_OPERATIONS_ENABLED = prior;
  }
});

test('a positive probe still enters the locked claim and cannot overlap an active lane lease', async () => {
  let transactions = 0,
    locks = 0;
  const tx = {
    $executeRaw: async () => {
      locks++;
      return 0;
    },
    eagleAssetOperationItem: {
      count: async ({
        where,
      }: {
        where: {
          libraryMode: string;
          status: string;
          leaseUntil: { gt: Date };
          operation: { kind: unknown };
        };
      }) => {
        assert.equal(where.libraryMode, 'MATERIAL');
        assert.equal(where.status, 'RUNNING');
        assert.ok(where.leaseUntil.gt instanceof Date);
        assert.ok(
          where.operation.kind === 'SEND' ||
            JSON.stringify(where.operation.kind) === JSON.stringify({ not: 'SEND' }),
        );
        return 1;
      },
      findFirst: async () => assert.fail('active lease must prevent another claim'),
    },
  };
  const service = new EagleAssetOperationService(
    {
      eagleAssetOperationItem: { findFirst: async () => ({ id: 'hint' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        transactions++;
        return work(tx);
      },
    } as never,
    {} as never,
    {} as never,
  );
  await service.tick();
  assert.equal(transactions, 2);
  assert.equal(locks, 2);
});

test('batch trash skips owned retired entries and isolates unavailable entries without blocking valid resources', async () => {
  const active = randomUUID(),
    retired = randomUUID(),
    unavailable = randomUUID();
  const resources = [
    { id: active, deletedAt: null },
    { id: retired, deletedAt: new Date(), purgeAfter: null },
  ].map((row) => ({
    ...row,
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    rowVersion: 1,
    mediaRevision: 1,
    livePhotoIdentifier: null,
    livePhotoRole: null,
    isPrivate: false,
    mimeType: 'image/jpeg',
    lifecycleStatus: 'READY',
  }));
  const written: Array<{ status?: string; weight: number; errorCode?: string }> = [];
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eagleAssetOperation: {
      findUnique: async () => null,
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    eagleAssetOperationItem: {
      createMany: async ({ data }: { data: typeof written }) => {
        written.push(...data);
        return { count: data.length };
      },
    },
    eagleAsset: {
      findMany: async ({
        where,
      }: {
        where: { ownerId: string; libraryMode: string; id: { in: string[] }; deletedAt?: unknown };
      }) => {
        assert.equal(where.ownerId, 'owner');
        assert.equal(where.libraryMode, 'PHOTO');
        return resources.filter(
          (row) =>
            where.id.in.includes(row.id) &&
            (where.deletedAt === undefined || (where.deletedAt === null && row.deletedAt === null)),
        );
      },
    },
  };
  const service = new EagleAssetOperationService(
    { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx) } as never,
    {} as never,
    {} as never,
    'PHOTO',
  );
  const result = await service.enqueue({ sub: 'owner', canViewPrivate: false } as never, {
    operationId: randomUUID(),
    kind: 'TRASH',
    assetIds: [active, retired, unavailable],
  });
  assert.equal(result.total, 3);
  assert.equal(result.queued, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(written.map((row) => row.status ?? 'PENDING').sort(), [
    'FAILED',
    'PENDING',
    'SKIPPED',
  ]);
  assert.equal(written.find((row) => row.status === 'FAILED')?.errorCode, 'NOT_FOUND');
});

test('constructing the HTTP provider exposes no Nest lifecycle that starts background execution', () => {
  const service = new EagleAssetOperationService({} as never, {} as never, {} as never);
  assert.equal(Reflect.get(service, 'onModuleInit'), undefined);
});

test('a repeated selected ID is canonicalized without duplicating work or rejecting the user', async () => {
  const assetId = randomUUID(),
    operationId = randomUUID();
  const principal = { sub: 'owner', canViewPrivate: false } as AuthPrincipal;
  const existing = {
    id: operationId,
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    isPrivate: false,
    kind: 'SEND',
    inputIds: [assetId],
    items: [{ status: 'PENDING', weight: 1, errorCode: null }],
  };
  const tx = {
    $queryRaw: async () => [],
    eagleAssetOperation: { findUnique: async () => existing },
  };
  const service = new EagleAssetOperationService(
    { $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    {} as never,
    {} as never,
    'PHOTO',
  );
  const result = await service.enqueue(principal, {
    operationId,
    kind: 'SEND',
    assetIds: [assetId, assetId],
  });
  assert.equal(result.total, 1);
  assert.equal(result.queued, 1);
});


test('the legacy send route also accepts a large selection and only enqueues independent background work', async () => {
  const request = { operationId: randomUUID(), assetIds: Array.from({ length: 5001 }, () => randomUUID()) };
  await pipe.transform(request, { type: 'body', metatype: SendEagleAssetsDto });
  const principal = { sub: 'owner', canViewPrivate: false } as AuthPrincipal;
  let admitted = false;
  const controller = new EagleController(undefined as never, undefined as never, undefined as never, undefined as never,
    { send: () => { throw new Error('HTTP must not execute transfers'); } } as never,
    { enqueue: (actor: AuthPrincipal, input: unknown) => {
      assert.equal(actor, principal);
      assert.deepEqual(input, { ...request, kind: 'SEND' });
      admitted = true; return { queued: request.assetIds.length };
    } } as never);
  assert.deepEqual(controller.sendAssets(principal, request), { queued: 5001 });
  assert.equal(admitted, true);
});
