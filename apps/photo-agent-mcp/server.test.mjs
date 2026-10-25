import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPhotoAgentServer, validateLocalBase } from './server.mjs';
test('MCP refuses non-loopback endpoints and URL credentials', () => {
  for (const url of [
    'https://example.org',
    'http://192.168.31.89',
    'http://user:secret@127.0.0.1:3000',
    'http://127.0.0.1:8180/api',
  ])
    assert.throws(() => validateLocalBase(url));
  assert.equal(validateLocalBase('http://127.0.0.1:57894'), 'http://127.0.0.1:57894');
});
test('real MCP discovery and calls expose only scoped reads and proposals', async () => {
  const calls = [];
  const server = createPhotoAgentServer({
    baseUrl: 'http://127.0.0.1:3000',
    token: 'test-only',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new globalThis.Response(JSON.stringify({ items: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(a);
  await client.connect(b);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'photo_propose'));
    assert.ok(tools.every((t) => !/(delete|trash|apply|accept|undo|sql)/i.test(t.name)));
    const result = await client.callTool({ name: 'photo_list', arguments: { limit: 20 } });
    assert.equal(result.isError, undefined);
    assert.ok(calls[0].url.endsWith('/api/photos/agent/photos?limit=20'));
    assert.equal(calls[0].init.headers.authorization, 'Bearer test-only');
    assert.equal(calls[0].init.redirect, 'error');
    const bad = await client.callTool({
      name: 'photo_list',
      arguments: { limit: 20, ownerId: 'other' },
    });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('all proposal tools use fixed API paths and never accept a human decision', async () => {
  const calls = [];
  const server = createPhotoAgentServer({
    baseUrl: 'http://localhost:3000',
    token: 'test-only',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new globalThis.Response('{}');
    },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(a);
  await client.connect(b);
  const taskId = '00000000-0000-4000-8000-000000000001',
    assetId = '00000000-0000-4000-8000-000000000002';
  const city = {
    id: 'cn-zj-hangzhou',
    name: '杭州',
    country: '中国',
    region: '浙江',
    latitude: 30.25,
    longitude: 120.15,
  };
  try {
    for (const [name, args, suffix] of [
      [
        'photo_request_submit',
        {
          kind: 'DELETE',
          title: 'Test request',
          rationale: 'Agent defined test request.',
          items: [
            {
              assetId,
              evidenceIds: [],
              rationale: 'Reviewed the test photo.',
              visualReviewed: true,
            },
          ],
        },
        '/requests',
      ],
      ['photo_task_create', { kind: 'CITY', assetIds: [assetId] }, '/tasks'],
      ['photo_task', { taskId }, `/tasks/${taskId}`],
      [
        'photo_request_history',
        { taskId, limit: 20, after: assetId },
        `/tasks/${taskId}/history?after=${assetId}&limit=20`,
      ],
      [
        'photo_city_candidates',
        { taskId, cities: [city], offsetSeconds: 0 },
        `/tasks/${taskId}/infer-cities`,
      ],
      ['photo_visual_scores', { taskId, description: 'screenshot' }, `/tasks/${taskId}/scores`],
      [
        'photo_propose',
        {
          taskId,
          assetId,
          city,
          evidenceIds: [assetId],
          rationale: 'Reviewed photo and its GPS evidence.',
          visualReviewed: true,
        },
        `/tasks/${taskId}/suggestions`,
      ],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined);
      assert.ok(calls.at(-1).url.endsWith(suffix));
      const body = calls.at(-1).init.body;
      if (body) assert.equal(JSON.parse(body).taskId, undefined);
    }
    const tools = (await client.listTools()).tools;
    assert.equal(
      tools.find((t) => t.name === 'photo_request_history').annotations.readOnlyHint,
      true,
    );
    const historyCall = calls.find((call) => call.url.includes('/history?'));
    assert.equal(historyCall.init.method, 'GET');
    assert.equal(historyCall.init.body, undefined);
    assert.equal(
      tools.find((t) => t.name === 'photo_task_create').annotations.idempotentHint,
      false,
    );
    const bad = await client.callTool({
      name: 'photo_propose',
      arguments: {
        taskId,
        assetId,
        evidenceIds: [],
        rationale: 'Reviewed image contents.',
        visualReviewed: false,
        action: 'ACCEPT',
      },
    });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('preview transport returns bounded image blocks and rejects oversize, unexpected type and HTTP errors', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const cases = [
    () => new globalThis.Response('image', { headers: { 'content-type': 'image/webp' } }),
    () => new globalThis.Response('not an image', { headers: { 'content-type': 'text/plain' } }),
    () =>
      new globalThis.Response('x', {
        headers: { 'content-type': 'image/webp', 'content-length': '2097152' },
      }),
    () =>
      new globalThis.Response('x'.repeat(1048577), { headers: { 'content-type': 'image/webp' } }),
    () => new globalThis.Response('secret-body', { status: 403 }),
    () => new globalThis.Response(null),
  ];
  for (const [index, response] of cases.entries()) {
    const server = createPhotoAgentServer({
      baseUrl: 'http://127.0.0.1:3000',
      token: 'test-only',
      fetch: async () => response(),
    });
    const [a, b] = InMemoryTransport.createLinkedPair(),
      client = new Client({ name: 'test', version: '1' });
    await server.connect(a);
    await client.connect(b);
    try {
      const result = await client.callTool({ name: 'photo_preview', arguments: { assetId: id } });
      if (index === 0) {
        assert.equal(result.content[0].type, 'image');
        assert.equal(result.content[0].mimeType, 'image/webp');
      } else {
        assert.equal(result.isError, true);
        assert.ok(!JSON.stringify(result).includes('secret-body'));
      }
    } finally {
      await client.close();
      await server.close();
    }
  }
  assert.throws(() => createPhotoAgentServer({ baseUrl: 'http://127.0.0.1:3000', token: '' }));
});

test('stdio entry point completes a real client handshake without starting or connecting to any runtime', async () => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('./main.mjs', import.meta.url).pathname],
    env: { SEKEREAGLE_AGENT_URL: 'http://127.0.0.1:9', SEKEREAGLE_AGENT_PAT: 'test-only' },
  });
  const client = new Client({ name: 'stdio-test', version: '1' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 10);
  } finally {
    await client.close();
  }
});

test('metadata requests are honest and saved instructions are read-only', async () => {
  const calls = [];
  const server = createPhotoAgentServer({baseUrl:'http://127.0.0.1:3000',token:'test-only',fetch:async(url,init)=>{calls.push({url,init});return new Response('{}');}});
  const [a,b]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'test',version:'1'});
  await server.connect(a);await client.connect(b);
  try {
    const result=await client.callTool({name:'photo_request_submit',arguments:{kind:'SEND_TO_MATERIAL',title:'Metadata only',rationale:'Filename explicitly marks a screenshot.',items:[{assetId:'00000000-0000-4000-8000-000000000001',evidenceIds:[],visualReviewed:false,rationale:'Filename contains Screenshot; image not viewed.'}]}});
    assert.equal(result.isError,undefined);
    assert.equal(JSON.parse(calls.at(-1).init.body).items[0].visualReviewed,false);
    const instructions=await client.callTool({name:'photo_instructions',arguments:{}});
    assert.equal(instructions.isError,undefined);
    assert.ok(calls.at(-1).url.endsWith('/instructions'));
    assert.equal(calls.at(-1).init.method,'GET');
    assert.ok((await client.listTools()).tools.find(t=>t.name==='photo_instructions').annotations.readOnlyHint);
  } finally {await client.close();await server.close();}
});
