import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEagleAssetCursor, encodeEagleAssetCursor } from './eagle-cursor';

test('encodes the current library-added cursor format', () => {
  const timestamp = new Date('2026-01-02T03:04:05.000Z');
  const encoded = encodeEagleAssetCursor({ libraryAddedAt: timestamp, id: 'asset-1' });
  const payload: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.deepEqual(payload, { v: 2, libraryAddedAt: timestamp.toISOString(), id: 'asset-1' });
  assert.deepEqual(decodeEagleAssetCursor(encoded), { libraryAddedAt: timestamp, id: 'asset-1' });
});

test('decodes the original v1 created-at cursor for compatibility', () => {
  const encoded = Buffer.from(
    JSON.stringify({ v: 1, createdAt: '2025-01-01T00:00:00.000Z', id: 'old' }),
  ).toString('base64url');
  assert.deepEqual(decodeEagleAssetCursor(encoded), {
    libraryAddedAt: new Date('2025-01-01T00:00:00.000Z'),
    id: 'old',
  });
});

test('scoped cursor cannot cross library mode or owner', () => {
  const material = { ownerId: 'owner-a', libraryMode: 'MATERIAL' as const };
  const photo = { ownerId: 'owner-a', libraryMode: 'PHOTO' as const };
  const cursor = encodeEagleAssetCursor({ libraryAddedAt: new Date('2026-01-01'), id: 'asset' }, photo);
  assert.equal(decodeEagleAssetCursor(cursor, photo).id, 'asset');
  assert.throws(() => decodeEagleAssetCursor(cursor, material));
  assert.throws(() => decodeEagleAssetCursor(cursor, { ...photo, ownerId: 'owner-b' }));
  const legacy = encodeEagleAssetCursor({ libraryAddedAt: new Date('2026-01-01'), id: 'asset' });
  assert.throws(() => decodeEagleAssetCursor(legacy, photo));
  assert.equal(decodeEagleAssetCursor(legacy, material).id, 'asset');
});
