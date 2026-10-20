import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { securityResponse } from './security-response';

test('HTTP security headers cover failed authentication and token responses without caching', async () => {
  const server = createServer((request, response) => {
    response.setHeader('X-Powered-By', 'synthetic-test');
    securityResponse(request as never, response as never, () => {
      response.writeHead(401);
      response.end('unauthorized');
    });
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    for (const path of [
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/me',
      '/api/tokens',
      '/api/tokens/token-id',
      '/api/backup/status',
      '/api/photos/agent/tasks',
      '/api/photos/privacy-visibility',
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
      );
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('x-powered-by'), null);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
