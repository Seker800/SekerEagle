import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('people pages enforce owner/privacy and return a stable continuation instead of truncating', async () => {
  const ids = Array.from(
    { length: 205 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );
  const queries: Array<{ where: Record<string, unknown>; take: number }> = [];
  const db = {
    eaglePhotoPerson: {
      findMany: async (query: { where: Record<string, unknown>; take: number }) => {
        queries.push(query);
        const after = (
          query.where.AND as Array<{ OR: Array<{ id?: { gt: string } }> }> | undefined
        )?.[0]?.OR[1]?.id?.gt;
        return ids
          .filter((id) => !after || id > after)
          .slice(0, query.take)
          .map((id) => ({ id, faces: [], createdAt: new Date('2026-10-20T00:00:00Z') }));
      },
    },
  };
  const service = new PhotoManagementService(db as never);
  const first = await service.people('owner', false);
  assert.equal(first.people.length, 200);
  assert.deepEqual((queries[0] as unknown as { orderBy: unknown }).orderBy, [
    { createdAt: 'asc' },
    { id: 'asc' },
  ]);
  assert.ok(first.nextCursor);
  assert.equal(JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()).id, ids[199]);
  assert.equal((await service.people('owner', false, first.nextCursor)).people.length, 5);
  await assert.rejects(service.people('other-owner', false, first.nextCursor), /游标无效/);
  await assert.rejects(service.people('owner', true, first.nextCursor), /游标无效/);
  await assert.rejects(service.people('owner', false, 'invalid'), /游标无效/);
  assert.equal(queries[0]?.where.ownerId, 'owner');
  assert.equal(queries[0]?.where.libraryMode, 'PHOTO');
  assert.equal(queries[0]?.where.marksAssetsPrivate, false);
});
