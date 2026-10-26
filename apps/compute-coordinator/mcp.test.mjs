import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createComputeMcp } from './mcp.mjs';
test('agent tools expose policy and status but no enrollment, secrets or command execution', async (t) => {
  const calls = [];
  const server = createComputeMcp({
    baseUrl: 'http://127.0.0.1:11436',
    token: 'management-token',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return globalThis.Response.json({ revision: 1, nodes: [] });
    },
  });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  t.after(() => server.close());
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((x) => x.name).sort(), [
    'compute_set_policy',
    'compute_status',
  ]);
  await client.callTool({ name: 'compute_status', arguments: {} });
  assert.equal(calls[0].options.method, 'GET');
  const response = await client.callTool({
    name: 'compute_set_policy',
    arguments: {
      expectedRevision: 1,
      nodeId: 'mac',
      enabled: false,
      concurrency: 1,
      operations: ['embedding'],
      durationSeconds: 60,
      reason: 'user busy',
    },
  });
  assert.ok(!response.isError);
  assert.ok(calls[1].url.endsWith('/admin/policy'));
  const rejected = await client.callTool({
    name: 'compute_set_policy',
    arguments: {
      expectedRevision: 1,
      nodeId: 'mac',
      enabled: true,
      concurrency: 999,
      operations: ['embedding'],
      durationSeconds: 60,
      reason: 'bad',
    },
  });
  assert.ok(rejected.isError);
  assert.equal(calls.length, 2);
  assert.throws(() => createComputeMcp({ baseUrl: 'http://example.com:11436', token: 'secret' }));
});
