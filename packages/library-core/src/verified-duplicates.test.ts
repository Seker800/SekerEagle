import assert from 'node:assert/strict';
import test from 'node:test';
import { findVerifiedPixelGroups, type DuplicateCandidate } from './duplicates';
const row = (id: string, patch: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  format: 'jpeg',
  sha256: id,
  mediaRevision: 1,
  rowVersion: 1,
  isPrivate: false,
  byteSize: 100,
  width: 1000,
  height: 800,
  rating: null,
  libraryAddedAt: '2020-01-01',
  fingerprint: { hash: '0123456789abcdef', colors: Array(48).fill(100), contrast: 30 },
  ...patch,
});
test('burst frames sharing a preview fingerprint are never proven duplicates', () => {
  assert.deepEqual(findVerifiedPixelGroups([row('a'), row('b')]), []);
});
test('metadata-different backups form one disjoint group with every copy and stable keeper', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id, { pixelHash: 'a'.repeat(64) }));
  const groups = findVerifiedPixelGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.assetIds.length, 5);
  assert.equal(groups[0]!.removableBytes, 400);
  assert.deepEqual(findVerifiedPixelGroups([...rows].reverse()), groups);
});
test('pixel proofs retain privacy, format, edited and live-photo boundaries', () => {
  const pixelHash = 'a'.repeat(64);
  assert.deepEqual(
    findVerifiedPixelGroups([
      row('a', { pixelHash }),
      row('private', { pixelHash, isPrivate: true }),
      row('png', { pixelHash, format: 'png' }),
      row('edited', { pixelHash, isEdited: true }),
      row('live', { pixelHash, isLivePhoto: true }),
      row('burst', { pixelHash: 'b'.repeat(64) }),
      row('invalid', { pixelHash: 'bad' }),
    ]),
    [],
  );
});
