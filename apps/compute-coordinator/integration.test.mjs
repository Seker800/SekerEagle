import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fleet } from './fleet.mjs';
import { createCoordinator, probeFleet } from './server.mjs';
const contract = { model: 'synthetic', revision: 'fixed', dimensions: 1024 };
async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
test('two real HTTP nodes share work and live enrollment needs no restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eagle-fleet-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const backend = createServer((req, res) => {
    void (async () => {
      for await (const chunk of req) void chunk;
      if (req.url !== '/healthz') calls++;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/healthz'
            ? { ...contract, status: 'ready', accelerator: 'cuda', capacity: { inFlight: 0 } }
            : { ...contract, normalized: true, embedding: [1, ...Array(1023).fill(0)] },
        ),
      );
    })();
  });
  const address = await listen(t, backend);
  const fleet = new Fleet({ directory, contract });
  await fleet.initialize([]);
  const server = createCoordinator({
    fleet,
    executionToken: 'execution-token',
    adminToken: 'management-token',
  });
  const base = await listen(t, server);
  const node = {
    id: 'windows',
    name: '3090',
    url: address,
    token: 'backend-token',
    accelerator: 'cuda',
    maxConcurrent: 2,
    reserveInteractive: 0,
    enabled: true,
    verified: true,
    operations: ['embedding'],
  };
  const enrolled = await fetch(base + '/admin/enroll', {
    method: 'POST',
    headers: { authorization: 'Bearer management-token' },
    body: JSON.stringify({ expectedRevision: 0, node }),
  });
  assert.equal(enrolled.status, 200);
  await probeFleet(fleet);
  const results = await Promise.all(
    [1, 2].map(() =>
      fetch(base + '/v1/embeddings/image', {
        method: 'POST',
        headers: {
          authorization: 'Bearer execution-token',
          'content-type': 'image/jpeg',
          'x-embedding-dimensions': '1024',
        },
        body: 'synthetic bytes',
      }),
    ),
  );
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.equal((await r.json()).embedding.length, 1024);
  }
  assert.equal(calls, 2);
  await fleet.update({
    expectedRevision: 1,
    nodeId: 'windows',
    enabled: false,
    concurrency: 1,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'stop new work',
  });
  assert.equal(
    (
      await fetch(base + '/v1/embeddings/image', {
        method: 'POST',
        headers: {
          authorization: 'Bearer execution-token',
          'content-type': 'image/jpeg',
          'x-embedding-dimensions': '1024',
        },
        body: 'x',
      })
    ).status,
    503,
  );
});
test('caller disconnect cannot release a still-computing upstream reservation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eagle-fleet-cancel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let finish, received;
  const gate = new Promise((resolve) => {
      finish = resolve;
    }),
    started = new Promise((resolve) => {
      received = resolve;
    });
  const backend = createServer((req, res) => {
    void (async () => {
      for await (const chunk of req) void chunk;
      received();
      await gate;
      res.end('{}');
    })();
  });
  const address = await listen(t, backend);
  const fleet = new Fleet({ directory, contract });
  await fleet.initialize([
    {
      id: 'mac',
      name: 'Mac',
      url: address,
      token: 'backend-token',
      accelerator: 'metal',
      maxConcurrent: 1,
      reserveInteractive: 0,
      enabled: true,
      verified: true,
      operations: ['embedding'],
    },
  ]);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true });
  const base = await listen(
    t,
    createCoordinator({ fleet, executionToken: 'execution-token', adminToken: 'management-token' }),
  );
  const abort = new globalThis.AbortController();
  const response = fetch(base + '/v1/embeddings/image', {
    method: 'POST',
    headers: {
      authorization: 'Bearer execution-token',
      'content-type': 'image/jpeg',
      'x-embedding-dimensions': '1024',
    },
    body: 'x',
    signal: abort.signal,
  }).catch(() => null);
  await started;
  abort.abort();
  await response;
  await delay(10);
  assert.equal(fleet.snapshot().nodes[0].inFlight, 1);
  finish();
  for (let i = 0; i < 50 && fleet.snapshot().nodes[0].inFlight; i++) await delay(10);
  assert.equal(fleet.snapshot().nodes[0].inFlight, 0);
});
