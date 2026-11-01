import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readMemoryPage, libraryReadMetrics } from './eagle-memory-client';

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
