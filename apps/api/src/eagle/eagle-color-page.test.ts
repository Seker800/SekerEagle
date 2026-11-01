import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeColorCursor, decodeColorCursor } from './eagle-color-page';
const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
const position = { id: 'asset', score: 1.25, time: '2026-11-01T00:00:00.000Z' };
test('color pages bind score positions to owner, mode and complete filter context', () => {
  const value = encodeColorCursor(position, scope, 'query');
  assert.deepEqual(decodeColorCursor(value, scope, 'query'), position);
  for (const [s, q] of [
    [{ ...scope, ownerId: 'other' }, 'query'],
    [{ ...scope, libraryMode: 'MATERIAL' }, 'query'],
    [scope, 'changed'],
  ] as const)
    assert.throws(() => decodeColorCursor(value, s, q), /颜色筛选游标/);
  assert.throws(() => decodeColorCursor('old-date-cursor', scope, 'query'), /颜色筛选游标/);
});
