import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { REQUIRED_PAT_SCOPES } from '../auth/required-scopes';
import { EagleBrowserCaptureController } from './eagle-browser-capture.controller';

test('browser capture endpoints require authentication and the least-privilege PAT scope', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, EagleBrowserCaptureController), [
    AccessAuthGuard,
    PatScopeGuard,
  ]);
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PAT_SCOPES, EagleBrowserCaptureController), [
    'capture:write',
  ]);
});

test('browser capture keeps burst limiting and origin checks on every state-changing endpoint', () => {
  assert.equal(
    Reflect.getMetadata(`${THROTTLER_SKIP}default`, EagleBrowserCaptureController),
    true,
  );
  assert.notEqual(
    Reflect.getMetadata(`${THROTTLER_SKIP}short`, EagleBrowserCaptureController),
    true,
  );

  for (const name of ['initiate', 'presignPart', 'complete', 'abort'] as const) {
    const handler = Object.getOwnPropertyDescriptor(EagleBrowserCaptureController.prototype, name)
      ?.value as object | undefined;
    assert.ok(handler);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOrPatOriginGuard]);
  }
});
