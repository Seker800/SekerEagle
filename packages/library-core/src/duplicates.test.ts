import assert from 'node:assert/strict';
import test from 'node:test';
import { findDuplicateGroups, type DuplicateCandidate } from './duplicates';
const item = (id: string, patch: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  sha256: null,
  mediaRevision: 1,
  rowVersion: 1,
  isPrivate: false,
  byteSize: 100,
  width: 1000,
  height: 800,
  rating: null,
  libraryAddedAt: '2020-01-01',
  fingerprint: null,
  ...patch,
});
test('exact files ignore names, retain private boundaries and prefer useful metadata', () => {
  const rows = [
    item('a', { sha256: 'same' }),
    item('b', { sha256: 'same', rating: 5 }),
    item('c', { sha256: 'same', isPrivate: true }),
  ];
  const groups = findDuplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.kind, 'EXACT');
  assert.equal(groups[0]!.recommendedId, 'b');
  assert.deepEqual(groups[0]!.assetIds, ['b', 'a']);
});
test('visual candidates require shape, colour and non-flat content, with no transitive chaining', () => {
  const fp = (hash: string) => ({ hash, colors: Array(48).fill(100) as number[], contrast: 30 });
  const rows = [
    item('a', { fingerprint: fp('0123456789abcdef') }),
    item('b', { fingerprint: fp('0123456789abcde0') }),
    item('c', { fingerprint: fp('0123456789abc000') }),
    item('flat', { fingerprint: { ...fp('0123456789abcdef'), contrast: 0 } }),
    item('shape', { width: 300, fingerprint: fp('0123456789abcdef') }),
    item('color', { fingerprint: { ...fp('0123456789abcdef'), colors: Array(48).fill(220) } }),
  ];
  const groups = findDuplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.assetIds, ['a', 'b']);
  assert.equal(groups[0]!.kind, 'SIMILAR');
});
test('exact members cannot silently disappear from a visual group and results are deterministic', () => {
  const fingerprint = { hash: '0123456789abcdef', colors: Array(48).fill(100), contrast: 30 };
  const rows = [
    item('a', { sha256: 'same', fingerprint }),
    item('b', { sha256: 'same', fingerprint }),
    item('c', { fingerprint }),
  ];
  const groups = findDuplicateGroups(rows);
  assert.deepEqual(findDuplicateGroups([...rows].reverse()), groups);
  assert.deepEqual(
    groups.map((g) => g.assetIds),
    [
      ['a', 'b'],
      ['a', 'c'],
    ],
  );
});
test('missing and malformed fingerprints are not duplicate evidence', () => {
  assert.deepEqual(
    findDuplicateGroups([
      item('a'),
      item('b'),
      item('x', { fingerprint: { hash: 'bad', colors: [], contrast: 30 } }),
    ]),
    [],
  );
});
