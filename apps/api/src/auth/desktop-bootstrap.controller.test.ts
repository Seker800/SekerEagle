import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BrowserOriginGuard } from './browser-origin.guard';
import { DesktopBootstrapController } from './desktop-bootstrap.controller';

void test('desktop bootstrap requires an explicitly trusted browser origin', async () => {
  const handler = Reflect.get(DesktopBootstrapController.prototype, 'bootstrap') as object;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOriginGuard]);

  const controller = new DesktopBootstrapController({ get: async () => 'a'.repeat(64) } as never);
  assert.deepEqual(await controller.bootstrap(), {
    version: 1,
    deploymentId: 'a'.repeat(64),
  });
});
