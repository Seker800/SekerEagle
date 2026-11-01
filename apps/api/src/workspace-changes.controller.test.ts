import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WorkspaceChangesController } from './workspace-changes.controller';
import { AccessAuthGuard } from './auth/access-auth.guard';
import { BrowserPrincipalGuard } from './auth/browser-principal.guard';

test('changes transport derives owner and private visibility from its browser principal', async () => {
  const calls: unknown[] = [];
  const controller = new WorkspaceChangesController({
    snapshot: async (...args: unknown[]) => {
      calls.push(args);
      return { epoch: 'test', scopes: { MATERIAL: {}, PHOTO: {} } };
    },
  } as never);
  await controller.snapshot({ sub: 'owner-a', canViewPrivate: false } as never);
  await controller.snapshot({ sub: 'owner-b', canViewPrivate: true } as never);
  assert.deepEqual(calls, [
    ['owner-a', false],
    ['owner-b', true],
  ]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, WorkspaceChangesController), [
    AccessAuthGuard,
    BrowserPrincipalGuard,
  ]);
});
test('an unavailable listener reports retryable unavailability instead of consuming changes', async () => {
  const controller = new WorkspaceChangesController({
    snapshot: async () => {
      throw new Error('offline');
    },
  } as never);
  await assert.rejects(
    controller.snapshot({ sub: 'owner', canViewPrivate: false } as never),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 503,
  );
});
