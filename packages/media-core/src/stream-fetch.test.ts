import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { streamFetch } from '../stream-fetch.cjs';

test('media HTTP transport waits for computation headers within the explicit deadline', async (t) => {
  const server = createServer((req, res) => {
    void (async () => {
      let bytes = 0;
      for await (const chunk of req) bytes += chunk.length;
      setTimeout(() => res.end(String(bytes)), 50);
    })().catch(() => res.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await streamFetch(base, {
    method: 'POST',
    body: Readable.from(['input']),
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(await response.text(), '5');
  await assert.rejects(
    streamFetch(base, {
      method: 'POST',
      body: Readable.from(['input']),
      signal: AbortSignal.timeout(10),
    }),
  );
});

test('media HTTP transport rejects redirects and cancellation closes an incomplete response', async (t) => {
  let closed = false;
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === '/invalid-status') {
      res.writeHead(600);
      res.end();
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/private' });
      res.end();
      return;
    }
    res.writeHead(200);
    res.write('start');
    res.on('close', () => {
      closed = true;
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await assert.rejects(
    streamFetch(base + '/redirect', { signal: AbortSignal.timeout(1000) }),
    /REDIRECT/,
  );
  await assert.rejects(
    streamFetch(base + '/invalid-status', { signal: AbortSignal.timeout(1000) }),
    RangeError,
  );
  const response = await streamFetch(base, { signal: AbortSignal.timeout(1000) });
  await response.body!.cancel();
  for (let i = 0; !closed && i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(closed, true);
});

test('media HTTP total deadline also aborts after headers during an unfinished body', async (t) => {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200);
    res.write('partial');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await streamFetch(base, { signal: AbortSignal.timeout(50) });
  await assert.rejects(response.text());
});
