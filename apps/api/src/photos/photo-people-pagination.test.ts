import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('people pages enforce owner/privacy and return a stable continuation instead of truncating', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => `person-${String(i).padStart(4, '0')}`);
  const queries: Array<{ where: Record<string, unknown>; take: number }> = [];
  const db = { eaglePhotoPerson: { findMany: async (query: { where: Record<string, unknown>; take: number }) => {
    queries.push(query);
    const after = (query.where.id as { gt?: string } | undefined)?.gt;
    return ids.filter(id => !after || id > after).slice(0, query.take).map(id => ({id, faces: []}));
  } } };
  const service = new PhotoManagementService(db as never);
  const first = await service.people('owner', false);
  assert.equal(first.people.length, 200);
  assert.equal((first as unknown as {nextCursor: string}).nextCursor, ids[199]);
  assert.equal(queries[0]?.where.ownerId, 'owner');
  assert.equal(queries[0]?.where.libraryMode, 'PHOTO');
  assert.equal(queries[0]?.where.marksAssetsPrivate, false);
});
