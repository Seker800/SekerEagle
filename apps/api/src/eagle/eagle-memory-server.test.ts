import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLibraryReaderServer } from './eagle-memory-server';
import { LibraryMemoryIndex } from './eagle-memory-index';

test('internal reader authenticates before reading and validates scope, page and byte bounds', async () => {
  let reads = 0;
  const token = 'test-reader-identity';
  const server = createLibraryReaderServer({ synchronize: async ({ ownerId, libraryMode }) => { reads++; const index = new LibraryMemoryIndex(ownerId, libraryMode); index.replace('1', []); return index; } }, token, 1024);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/query`;
  const query = { scope: { ownerId: 'owner', libraryMode: 'PHOTO' }, where: {}, action: 'page', date: 'chronologicalAt', direction: 'desc', take: 41, skip: 0 };
  const post = (body: unknown, authorization?: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(query)).status, 401);
    assert.equal((await post(query, 'Bearer wrong')).status, 401);
    assert.equal(reads, 0);
    assert.equal((await post({ ...query, scope: { ...query.scope, libraryMode: 'OTHER' } }, `Bearer ${token}`)).status, 400);
    assert.equal((await post({ ...query, take: -1 }, `Bearer ${token}`)).status, 400);
    assert.equal((await post({ ...query, where: { data: 'x'.repeat(2000) } }, `Bearer ${token}`)).status, 413);
    const response = await post(query, `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: '1', ids: [] });
    assert.equal(reads, 1);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
