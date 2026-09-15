import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserOriginGuard } from './browser-origin.guard';

function contextFor(headers: Record<string, string>, protocol = 'http'): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, protocol }) }),
  } as unknown as ExecutionContext;
}

const guard = new BrowserOriginGuard(
  new ConfigService({
    BROWSER_TRUSTED_ORIGINS: [
      'http://localhost:8180',
      'http://192.168.31.139:8180',
      'https://eagle.example.com',
    ],
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

void test('accepts an unconfigured private-network address when the browser is same-origin', () => {
  assert.equal(
    guard.canActivate(
      contextFor({ origin: 'http://192.168.31.169:8180', host: '192.168.31.169:8180' }),
    ),
    true,
  );
  assert.equal(
    guard.canActivate(
      contextFor({ referer: 'http://10.42.0.8:8180/library', host: '10.42.0.8:8180' }),
    ),
    true,
  );
  assert.equal(
    guard.canActivate(contextFor({ origin: 'http://[fd12::34]:8180', host: '[fd12::34]:8180' })),
    true,
  );
});

void test('accepts an explicitly configured public origin', () => {
  assert.equal(
    guard.canActivate(
      contextFor({ origin: 'https://eagle.example.com', host: 'eagle.example.com' }, 'https'),
    ),
    true,
  );
});

void test('rejects private-network cross-site, protocol, and port mismatches', () => {
  assert.throws(() =>
    guard.canActivate(
      contextFor({ origin: 'http://192.168.31.140:8180', host: '192.168.31.169:8180' }),
    ),
  );
  assert.throws(() =>
    guard.canActivate(
      contextFor({ origin: 'https://192.168.31.169:8180', host: '192.168.31.169:8180' }),
    ),
  );
  assert.throws(() =>
    guard.canActivate(
      contextFor({ origin: 'http://192.168.31.169:8181', host: '192.168.31.169:8180' }),
    ),
  );
});

void test('does not treat a same-host public DNS name as trusted without explicit configuration', () => {
  assert.throws(() =>
    guard.canActivate(contextFor({ origin: 'http://evil.example', host: 'evil.example' })),
  );
  assert.throws(() =>
    guard.canActivate(contextFor({ origin: 'http://203.0.113.5:8180', host: '203.0.113.5:8180' })),
  );
});

void test('rejects malformed source and target origins', () => {
  assert.throws(() =>
    guard.canActivate(
      contextFor({ origin: 'http://192.168.31.169:8180/path', host: '192.168.31.169:8180' }),
    ),
  );
  assert.throws(() =>
    guard.canActivate(contextFor({ origin: 'null', host: '192.168.31.169:8180' })),
  );
  assert.throws(() =>
    guard.canActivate(
      contextFor({
        referer: 'http://user:password@192.168.31.169:8180/library',
        host: '192.168.31.169:8180',
      }),
    ),
  );
  assert.throws(() => guard.canActivate(contextFor({ origin: 'http://192.168.31.169:8180' })));
});

void test('rejects missing and cross-site origins', () => {
  assert.throws(() => guard.canActivate(contextFor({})));
  assert.throws(() => guard.canActivate(contextFor({ origin: 'http://evil.local' })));
  assert.throws(() => guard.canActivate(contextFor({ origin: 'http://192.168.31.140:8180' })));
});
