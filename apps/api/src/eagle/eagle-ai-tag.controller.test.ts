import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { EagleAiTagController } from './eagle-ai-tag.controller';

function method(name: keyof EagleAiTagController): object {
  const handler = Object.getOwnPropertyDescriptor(EagleAiTagController.prototype, name)?.value;
  assert.equal(typeof handler, 'function');
  return handler as object;
}

test('AI tag reads require an authenticated browser principal', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, EagleAiTagController), [
    AccessAuthGuard,
    BrowserPrincipalGuard,
  ]);
});

test('AI tag queue mutations additionally require a same-origin browser request', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method('scanMissing')), [
    BrowserOriginGuard,
  ]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method('retryFailed')), [
    BrowserOriginGuard,
  ]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method('updateSettings')), [
    BrowserOriginGuard,
  ]);
});
