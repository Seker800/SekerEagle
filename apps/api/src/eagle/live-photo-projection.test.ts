import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLivePhotoMotions } from './live-photo-projection';
test('pair projection requires unique roles, scoped visibility and current media versions', async () => {
  const queries: unknown[] = [];
  let counts = [
    { livePhotoIdentifier: 'same', livePhotoRole: 'STILL', _count: { id: 1 } },
    { livePhotoIdentifier: 'same', livePhotoRole: 'MOTION', _count: { id: 1 } },
  ];
  const rows = [
    {
      id: 'still',
      livePhotoIdentifier: 'same',
      livePhotoRole: 'STILL',
      mediaRevision: 2,
      renditions: [],
    },
    {
      id: 'movie',
      livePhotoIdentifier: 'same',
      livePhotoRole: 'MOTION',
      mediaRevision: 3,
      renditions: [
        { id: 'outdated', revision: 1 },
        { id: 'playback', revision: 3 },
      ],
    },
  ];
  const db = {
    eagleAsset: {
      groupBy: async (query: unknown) => {
        queries.push(query);
        return counts;
      },
      findMany: async () => rows,
    },
  } as never;
  const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const },
    sources = [rows[0]!];
  const result = await resolveLivePhotoMotions(db, scope, sources, false);
  assert.deepEqual(result.get('still'), { assetId: 'movie', renditionId: 'playback', revision: 3 });
  const where = (queries[0] as { where: Record<string, unknown> }).where;
  assert.equal(where.ownerId, 'owner');
  assert.equal(where.libraryMode, 'PHOTO');
  assert.equal(where.deletedAt, null);
  assert.equal(where.isPrivate, false);
  assert.equal(
    (await resolveLivePhotoMotions(db, scope, [{ ...rows[0]!, mediaRevision: 4 }], false)).size,
    0,
  );
  counts = counts.map((row) => ({ ...row, _count: { id: 2 } }));
  assert.equal((await resolveLivePhotoMotions(db, scope, sources, true)).size, 0);
  assert.equal(
    (await resolveLivePhotoMotions(db, scope, [{ id: 'ordinary', mediaRevision: 1 }], false)).size,
    0,
  );
});
