import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Fleet } from './fleet.mjs';
import { createCoordinator } from './server.mjs';
const contract = { model: 'Qwen/Qwen3-VL-Embedding-2B', revision: 'fixed', dimensions: 1024 };
async function setup(
  t,
  fetcher = async () =>
    new globalThis.Response(JSON.stringify({ embedding: [1], ...contract, normalized: true }), {
      headers: { 'content-type': 'application/json' },
    }),
) {
  const dir = await mkdtemp(join(tmpdir(), 'eagle-coordinator-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fleet = new Fleet({ directory: dir, contract });
  await fleet.initialize([
    {
      id: 'mac',
      name: 'Mac',
      url: 'http://127.0.0.1:11435',
      token: 'backend-token',
      accelerator: 'metal',
      operations: ['embedding'],
      maxConcurrent: 2,
      reserveInteractive: 1,
      enabled: true,
    },
  ]);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true });
  const server = createCoordinator({
    fleet,
    executionToken: 'execution-token',
    adminToken: 'management-token',
    fetcher,
    timeoutMs: 1000,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, body, extra = {}) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return { fleet, call, base };
}
test('management and execution credentials cannot cross boundaries', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/admin/fleet', 'execution-token')).status, 401);
  assert.equal((await call('/healthz', 'management-token')).status, 401);
  assert.equal((await call('/healthz', 'wrong')).status, 401);
  const p = await (await call('/admin/fleet', 'management-token')).json();
  assert.ok(!JSON.stringify(p).includes('backend-token'));
});
test('hot policy drains immediately; stale revision returns conflict', async (t) => {
  const { call } = await setup(t);
  const p = {
    expectedRevision: 0,
    nodeId: 'mac',
    enabled: false,
    concurrency: 1,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'user busy',
  };
  assert.equal((await call('/admin/policy', 'management-token', p)).status, 200);
  assert.equal((await call('/admin/policy', 'management-token', p)).status, 409);
  const response = await call(
    '/v1/embeddings/text',
    'execution-token',
    { text: 'hello' },
    { 'x-embedding-dimensions': '1024' },
  );
  assert.equal(response.status, 503);
  assert.equal(
    (await (await call('/healthz', 'execution-token')).json()).capacity.backgroundLimit,
    0,
  );
});
test('authenticated proxy preserves dimensions and never forwards arbitrary URLs or headers', async (t) => {
  let observed;
  const { call } = await setup(t, async (url, options) => {
    observed = { url, headers: options.headers };
    return new globalThis.Response(
      JSON.stringify({ ...contract, normalized: true, embedding: [1] }),
    );
  });
  const r = await call(
    '/v1/embeddings/text',
    'execution-token',
    { text: 'hello' },
    { 'x-embedding-dimensions': '1024', 'x-untrusted': 'secret' },
  );
  assert.equal(r.status, 200);
  assert.equal(observed.url, 'http://127.0.0.1:11435/v1/embeddings/text');
  assert.equal(observed.headers.authorization, 'Bearer backend-token');
  assert.equal(observed.headers['x-untrusted'], undefined);
  assert.equal(
    (
      await call(
        '/v1/embeddings/text',
        'execution-token',
        { text: 'hello' },
        { 'x-embedding-dimensions': '512' },
      )
    ).status,
    409,
  );
  assert.equal((await call('/v1/evil', 'execution-token', {})).status, 404);
});
test('oversized management input and unexpected fields are rejected', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/admin/policy', 'management-token', 'x'.repeat(20000))).status, 413);
  assert.equal(
    (
      await call('/admin/policy', 'management-token', {
        expectedRevision: 0,
        nodeId: 'mac',
        enabled: true,
        concurrency: 1,
        operations: ['embedding'],
        durationSeconds: 60,
        reason: 'x',
        ownerId: 'other',
      })
    ).status,
    400,
  );
});
test('busy upstream quarantines node without consuming another node', async (t) => {
  const { call, fleet } = await setup(
    t,
    async () => new globalThis.Response('busy', { status: 503 }),
  );
  assert.equal(
    (
      await call('/v1/embeddings/image', 'execution-token', 'bytes', {
        'content-type': 'image/jpeg',
        'x-embedding-dimensions': '1024',
      })
    ).status,
    503,
  );
  assert.equal(fleet.snapshot().nodes[0].health, 'OFFLINE');
});

test('invalid enrollment inputs return 400 without mutating the fleet',async t=>{
 const {call,fleet}=await setup(t);assert.equal((await call('/admin/enroll','management-token','null')).status,400);
 assert.equal((await call('/admin/enroll','management-token',{expectedRevision:0,node:{id:'new',name:'New',url:'not-a-url'}})).status,400);assert.equal(fleet.snapshot().revision,0);
});
