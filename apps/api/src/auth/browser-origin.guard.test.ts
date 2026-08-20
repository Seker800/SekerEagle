import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserOriginGuard } from './browser-origin.guard';

function contextFor(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const guard = new BrowserOriginGuard(
  new ConfigService({
    BROWSER_TRUSTED_ORIGINS: ['http://localhost:8180', 'http://192.168.31.139:8180'],
  }),
);

void test('accepts the exact canonical origin', () => {
  assert.equal(guard.canActivate(contextFor({ origin: 'http://localhost:8180' })), true);
});

void test('accepts an explicitly configured LAN browser origin', () => {
  assert.equal(guard.canActivate(contextFor({ origin: 'http://192.168.31.139:8180' })), true);
  assert.equal(
    guard.canActivate(contextFor({ referer: 'http://192.168.31.139:8180/library' })),
    true,
  );
});

void test('rejects missing and cross-site origins', () => {
  assert.throws(() => guard.canActivate(contextFor({})));
  assert.throws(() => guard.canActivate(contextFor({ origin: 'http://evil.local' })));
  assert.throws(() => guard.canActivate(contextFor({ origin: 'http://192.168.31.140:8180' })));
});
