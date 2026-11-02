import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLibraryReaderServer } from './eagle-memory-server';
import { LibraryMemoryIndex } from './eagle-memory-index';

test('reader cannot start with missing identity or an invalid body byte budget', () => {
  const store = { read: async () => new LibraryMemoryIndex('owner', 'PHOTO') };
  assert.throws(() => createLibraryReaderServer(store, ''), /identity/);
  for (const bytes of [0, -1, NaN, 1.5])
    assert.throws(() => createLibraryReaderServer(store, 'identity', bytes), /budget/);
});

test('internal reader authenticates before reading and validates scope, page and byte bounds', async () => {
  let reads = 0;
  const token = 'test-reader-identity';
  const server = createLibraryReaderServer(
    {
      read: async ({ ownerId, libraryMode }) => {
        reads++;
        const index = new LibraryMemoryIndex(ownerId, libraryMode);
        index.replace('1', []);
        return index;
      },
    },
    token,
    1024,
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/query`;
  const query = {
    scope: { ownerId: 'owner', libraryMode: 'PHOTO' },
    where: {},
    action: 'page',
    date: 'chronologicalAt',
    direction: 'desc',
    take: 41,
    skip: 0,
  };
  const post = (body: unknown, authorization?: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post(query)).status, 401);
    assert.equal((await post(query, 'Bearer wrong')).status, 401);
    assert.equal(reads, 0);
    assert.equal(
      (await post({ ...query, scope: { ...query.scope, libraryMode: 'OTHER' } }, `Bearer ${token}`))
        .status,
      400,
    );
    assert.equal((await post({ ...query, take: -1 }, `Bearer ${token}`)).status, 400);
    assert.equal(
      (await post({ ...query, where: { data: 'x'.repeat(2000) } }, `Bearer ${token}`)).status,
      413,
    );
    const response = await post(query, `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: '1', ids: [] });
    assert.equal(reads, 1);
    const color = await post(
      {
        ...query,
        action: 'colorPage',
        colorPage: { color: '#ffffff', date: 'chronologicalAt', limit: 40, offset: 0 },
      },
      `Bearer ${token}`,
    );
    assert.equal(color.status, 200);
    assert.deepEqual(await color.json(), { revision: '1', positions: [] });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('semantic reader dispatches one complete page without exposing private service data', async () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('7', []);
  const positions = [
    {
      assetId: 'asset',
      tier: 1 as const,
      similarity: 0.9,
      libraryAddedAt: '2026-11-01T00:00:00.001Z',
    },
  ];
  let calls = 0;
  const server = createLibraryReaderServer(
    { read: async () => index },
    'semantic-test',
    2097152,
    {
      smartFolderPage: async (_index, options) => {
        calls++;
        assert.deepEqual(options.folderIds, ['folder']);
        return { revision: index.revision, positions };
      },
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/query`, {
      method: 'POST',
      headers: { authorization: 'Bearer semantic-test', 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: { ownerId: 'owner', libraryMode: 'PHOTO' },
        where: {},
        action: 'smartFolderPage',
        semantic: {
          folderIds: ['folder'],
          limit: 40,
          ordinaryMembersPossible: false,
          includePrivate: false,
          trash: false,
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: '7', positions });
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('photo facets capability is explicitly owned by the photo handler', () => {
  const server = createLibraryReaderServer(
    { read: async () => new LibraryMemoryIndex('owner', 'PHOTO') },
    'test',
    1024,
    {
      facets: async () => ({ cameras: [], lenses: [] }),
    },
  );
  server.close();
});
