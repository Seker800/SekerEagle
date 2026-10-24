import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { AccessAuthGuard } from './access-auth.guard';
import type { AuthPrincipal } from './auth.types';

void test('PAT self-revocation requires authentication and derives the only target from bearer identity', async () => {
  const calls: unknown[] = [];
  const controller = new AuthController(
    {} as never,
    {} as never,
    {} as never,
    { revokeCurrent: async (...args: unknown[]) => calls.push(args) } as never,
    {} as never,
    {} as never,
  );
  const handler = Reflect.get(AuthController.prototype, 'revokeCurrentToken') as object;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [AccessAuthGuard]);
  const request = {
    headers: { authorization: 'Bearer sea_pat_self' },
    body: { ownerId: 'foreign', tokenId: 'foreign' },
  } as unknown as Request;
  await assert.rejects(
    controller.revokeCurrentToken({ kind: 'browser' } as AuthPrincipal, request),
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(
    await controller.revokeCurrentToken(
      { kind: 'pat', sub: 'authenticated-owner' } as AuthPrincipal,
      request,
    ),
    { ok: true },
  );
  assert.deepEqual(calls, [['authenticated-owner', 'sea_pat_self']]);
});
