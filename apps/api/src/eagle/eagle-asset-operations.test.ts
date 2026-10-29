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
import { EnqueueAssetOperationDto } from './eagle-asset-operations.dto';
import { EagleAssetOperationService } from './eagle-asset-operations.service';
import { PhotosController } from '../photos/photo-library.module';
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const input = () => ({ operationId: randomUUID(), kind: 'SEND', assetIds: [randomUUID()] });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: EnqueueAssetOperationDto });
test('queue command validation rejects owner, mode, private escalation, unknown actions and duplicate/unbounded IDs', async () => {
  await validate(input());
  for (const extra of [
    { ownerId: randomUUID() },
    { libraryMode: 'PHOTO' },
    { isPrivate: true },
    { authVersion: 4 },
    { kind: 'PURGE' },
    { operationId: 'invalid' },
    { assetIds: ['invalid'] },
    { assetIds: Array(1001).fill(randomUUID()) },
  ])
    await assert.rejects(validate({ ...input(), ...extra }));
  const duplicate = randomUUID();
  await assert.rejects(validate({ ...input(), assetIds: [duplicate, duplicate] }));
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
  const service = new EagleAssetOperationService({
    eagleAssetOperationItem: { findFirst: async (args: unknown) => { probes.push(args); return null; } },
    $transaction: async () => { transactions++; return []; },
  } as never, {} as never, {} as never);
  await service.tick();
  assert.equal(probes.length, 2);
  assert.equal(transactions, 0);
  for (const probe of probes) assert.deepEqual((probe as {select:unknown}).select, {id:true});
});
