import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readMemoryPage, readMemoryCount, readMemorySmartFolderPage, readMemoryColorPage, requestLibraryRead, libraryReadMetrics } from './eagle-memory-client';

test('reader client requires a canonical scope and preserves page size and direction', async () => {
  const oldUrl = process.env.EAGLE_READER_URL,
    oldToken = process.env.EAGLE_READER_TOKEN;
  let calls = 0;
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    calls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.headers.authorization, 'Bearer test');
    assert.deepEqual(body.scope, { ownerId: 'owner', libraryMode: 'PHOTO' });
    assert.equal(body.take, 41);
    assert.equal(body.direction, 'desc');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ revision: '1', ids: ['a'] }));
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env.EAGLE_READER_URL = `http://127.0.0.1:${address.port}`;
  process.env.EAGLE_READER_TOKEN = 'test';
  try {
    assert.equal(await readMemoryPage({ where: { isPrivate: false }, take: 41 }), null);
    assert.equal(calls, 0);
    assert.deepEqual(
      await readMemoryPage({
        where: { libraryMode: 'PHOTO', AND: [{ ownerId: 'owner' }] },
        take: 41,
        orderBy: [{ chronologicalAt: 'desc' }, { id: 'desc' }],
      }),
      ['a'],
    );
    assert.equal(calls, 1);
    assert.ok(libraryReadMetrics.hits > 0);
  } finally {
    if (oldUrl === undefined) delete process.env.EAGLE_READER_URL;
    else process.env.EAGLE_READER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN;
    else process.env.EAGLE_READER_TOKEN = oldToken;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('reader client bounds failures and keeps the authenticated scope authoritative', async () => {
  const keys = ['EAGLE_READER_URL', 'EAGLE_READER_TOKEN', 'EAGLE_READER_TIMEOUT_MS'] as const;
  const before = keys.map(key => process.env[key]);
  let reply: unknown = { count: 0 }, status = 200, invalid = false, hold = false, received: unknown;
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received = JSON.parse(Buffer.concat(chunks).toString());
    if (hold) return;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(invalid ? 'invalid json' : JSON.stringify(reply));
  };
  const server = createServer((request, response) => { void handle(request, response); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
  const page = { where: scope, take: 1, orderBy: [{ chronologicalAt: 'desc' as const }, { id: 'desc' as const }] };
  process.env.EAGLE_READER_URL = `http://127.0.0.1:${address.port}`;
  process.env.EAGLE_READER_TOKEN = 'test';
  try {
    await requestLibraryRead(scope, { action: 'count', scope: { ownerId: 'other', libraryMode: 'MATERIAL' }, where: { ownerId: 'other' } });
    assert.deepEqual(received, { action: 'count', scope, where: scope });
    assert.equal(await readMemoryCount(scope), 0);
    for (const count of [-1, 0.5, null]) { reply = { count }; assert.equal(await readMemoryCount(scope), null); }
    for (const ids of [['a', 'a'], ['a', 'b'], [1]]) { reply = { ids }; assert.equal(await readMemoryPage(page), null); }
    reply = { ids: ['a'] };
    assert.deepEqual(await readMemoryPage(page), ['a']);
    assert.equal(await readMemoryPage({ ...page, select: { originalName: true } }), null);
    assert.equal(await readMemoryPage({ ...page, cursor: { id: 'a' } }), null);
    assert.equal(await readMemoryPage({ ...page, distinct: ['format'] }), null);
    assert.equal(await readMemoryPage({ ...page, take: -1 }), null);
    assert.equal(await readMemoryPage({ ...page, orderBy: [{ chronologicalAt: 'desc' }, { id: 'asc' }] }), null);
    assert.equal(await readMemoryCount({ AND: [scope, { ownerId: 'other' }] }), null);
    const position = { assetId: 'a', tier: 1 as const, similarity: 0.9, libraryAddedAt: '2026-11-01T00:00:00.000Z' };
    const semantic = { where: {}, folderIds: ['folder'], limit: 1, ordinaryMembersPossible: false, includePrivate: false, trash: false };
    reply = { positions: [position] };
    assert.deepEqual(await readMemorySmartFolderPage(scope, semantic), [position]);
    reply = { positions: [position, position] };
    assert.equal(await readMemorySmartFolderPage(scope, semantic), null);
    const color = { where: {}, color: '#ffffff', date: 'chronologicalAt' as const, limit: 1, offset: 0 };
    const ranked = { id: 'a', score: 0.01, time: position.libraryAddedAt, mediaRevision: 0 };
    reply = { positions: [ranked] };
    assert.deepEqual(await readMemoryColorPage(scope, color), [ranked]);
    reply = { positions: [{ ...ranked, score: null }] };
    assert.equal(await readMemoryColorPage(scope, color), null);
    status = 503; assert.equal(await readMemoryCount(scope), null);
    status = 200; invalid = true; assert.equal(await readMemoryCount(scope), null);
    invalid = false; hold = true; process.env.EAGLE_READER_TIMEOUT_MS = '25';
    assert.equal(await readMemoryCount(scope), null);
    delete process.env.EAGLE_READER_TOKEN;
    assert.equal(await readMemoryCount(scope), null);
  } finally {
    keys.forEach((key, at) => { if (before[at] === undefined) delete process.env[key]; else process.env[key] = before[at]; });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
