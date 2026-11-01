import assert from 'node:assert/strict';
import test from 'node:test';
import { findVisualDuplicateGroups, type DuplicateCandidate } from './duplicates';
const row = (id: string, patch: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  format: 'jpeg',
  sha256: id,
  byteSize: 100,
  mediaRevision: 1,
  rowVersion: 1,
  isPrivate: false,
  width: 4208,
  height: 2368,
  rating: null,
  libraryAddedAt: '2020-01-01',
  fingerprint: { hash: '92cb6532d8693d1a', colors: Array(48).fill(100), contrast: 30 },
  ...patch,
});
test('visual review finds resized, recompressed, cross-format and edited variants without hidden metadata conditions', () => {
  const rows = [
    row('original'),
    row('small', { width: 1919, height: 1080, byteSize: 60 }),
    row('png', { format: 'png', byteSize: 50 }),
    row('edited', { isEdited: true, byteSize: 40 }),
  ];
  const groups = findVisualDuplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.assetIds, ['original', 'png', 'edited', 'small']);
  assert.deepEqual(findVisualDuplicateGroups([...rows].reverse()), groups);
});
test('visual review retains exact copies, preserves privacy, and never chains through another image', () => {
  const fp = (hash: string) => ({ hash, colors: Array(48).fill(100), contrast: 30 });
  const groups = findVisualDuplicateGroups([
    row('a', { sha256: 'same', fingerprint: fp('0000000000000000') }),
    row('b', { sha256: 'same', fingerprint: fp('0000000000000000') }),
    row('c', { fingerprint: fp('000000000000001f') }),
    row('d', { fingerprint: fp('00000000000003ff') }),
    row('private', { isPrivate: true }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.assetIds),
    [['a', 'b', 'c']],
  );
});

test('metadata filtering cannot turn a reference-only match into a transitive pair', () => {
  const fp = (hash: string) => ({ hash, colors: Array(48).fill(100), contrast: 30 });
  const groups = findVisualDuplicateGroups([
    row('a', { fingerprint: fp('0000000000000000') }),
    row('b', { fingerprint: fp('000000000000001f') }),
    row('c', { fingerprint: fp('00000000000003e0') }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.assetIds),
    [['a', 'b']],
  );
});
test('a sixty-thousand-copy visual group compares unique fingerprints instead of every pair', () => {
  const groups = findVisualDuplicateGroups(Array.from({ length: 60000 }, (_, i) => row(String(i))));
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.assetIds.length, 60000);
});
