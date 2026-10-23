import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleService } from './eagle.service';
import { decodeEagleAssetCursor, encodeEagleAssetCursor } from './eagle-cursor';

test('jumped lists can prepend nearest newer rows without crossing owner, privacy or mode', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    const scope = { ownerId: 'owner', libraryMode: mode };
    const date = new Date('2026-01-02T00:00:00.000Z');
    let query: Record<string, unknown> = {};
    let rows = ['b', 'c', 'd'].map((id) => ({ id, libraryAddedAt: date, chronologicalAt: date }));
    const service = new EagleService(
      {
        eagleAsset: {
          findMany: async (input: Record<string, unknown>) => {
            query = input;
            return rows;
          },
        },
        eaglePhotoGroup: { findMany: async () => [] },
      } as never,
      undefined,
      mode,
    );
    const cursor = Buffer.from(
      JSON.stringify({
        v: 5,
        ...scope,
        sort: mode === 'PHOTO' ? 'CAPTURED_AT' : 'ADDED_AT',
        direction: 'NEWER',
        libraryAddedAt: date.toISOString(),
        id: 'a',
      }),
    ).toString('base64url');
    const result = await service.listAssets('owner', { limit: 2, cursor });
    assert.deepEqual(
      result.items.map((x) => x.id),
      ['c', 'b'],
    );
    assert.deepEqual(query.orderBy, [
      { [mode === 'PHOTO' ? 'chronologicalAt' : 'libraryAddedAt']: 'asc' },
      { id: 'asc' },
    ]);
    assert.equal(query.take, 3);
    const where = JSON.stringify(query.where);
    assert.match(where, /"ownerId":"owner"/);
    assert.match(where, /"isPrivate":false/);
    assert.match(where, /"deletedAt":null/);
    assert.match(where, /"gt":"a"/);
    const previous = (result as unknown as { previousCursor: string | null }).previousCursor;
    assert.equal(decodeEagleAssetCursor(previous!, scope).id, 'c');
    assert.equal(
      (decodeEagleAssetCursor(previous!, scope) as unknown as { direction: string }).direction,
      'NEWER',
    );
    assert.equal(decodeEagleAssetCursor(result.nextCursor!, scope).id, 'b');
    rows = rows.slice(0, 1);
    const end = await service.listAssets('owner', { limit: 2, cursor });
    assert.equal((end as unknown as { previousCursor: string | null }).previousCursor, null);
    const older = await service.listAssets('owner', {
      limit: 2,
      cursor: encodeEagleAssetCursor({ id: 'z', libraryAddedAt: date }, scope),
    });
    assert.ok((older as unknown as { previousCursor: string | null }).previousCursor);
    const head = await service.listAssets('owner', { limit: 2 });
    assert.equal((head as unknown as { previousCursor: string | null }).previousCursor, null);
  }
});
