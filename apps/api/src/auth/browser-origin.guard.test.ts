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
  new ConfigService({ CANONICAL_ORIGIN: 'http://localhost:8180' }),
);

void test('accepts the exact canonical origin', () => {
  assert.equal(guard.canActivate(contextFor({ origin: 'http://localhost:8180' })), true);
});

void test('rejects missing and cross-site origins', () => {
  assert.throws(() => guard.canActivate(contextFor({})));
  assert.throws(() => guard.canActivate(contextFor({ origin: 'http://evil.local' })));
});
