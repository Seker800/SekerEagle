import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from './eagle-memory-index';

const row = (id: string, date = '2026-11-01T00:00:00Z') => ({
  id,
  ownerId: 'owner',
  libraryMode: 'PHOTO',
  normalizedDisplayName: id,
  libraryAddedAt: date,
  chronologicalAt: date,
  deletedAt: null,
  isPrivate: false,
  rating: null,
  manualTagLinks: [],
  aiTagLinks: [],
  photoFaces: [],
  colorAnalyses: [],
});
test('index scopes all queries and returns only a bounded page in existing date/id order', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [row('a'), row('b'), row('c', '2026-10-01T00:00:00Z')]);
  assert.deepEqual(
    index.page({ ownerId: 'owner', libraryMode: 'PHOTO' }, 'chronologicalAt', 'desc', 2, 0),
    ['b', 'a'],
  );
  assert.deepEqual(index.page({ ownerId: 'other' }, 'chronologicalAt', 'desc', 2, 0), []);
  assert.equal(index.count({ isPrivate: false }), 3);
});
test('incremental replacement and deletion are published as one revision', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [row('a'), row('b')]);
  index.update('2', ['a', 'b'], [row('a', '2026-12-01T00:00:00Z')]);
  assert.equal(index.revision, '2');
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['a']);
  assert.throws(() => index.update('1', [], []), /revision/i);
});
test('an invalid batch cannot partially publish or cross owner/mode boundaries', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [row('a')]);
  assert.throws(
    () => index.update('2', ['a'], [row('b'), { ...row('other'), libraryMode: 'MATERIAL' }]),
    /scope/i,
  );
  assert.equal(index.revision, '1');
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['a']);
});

test('metadata changes update already sorted rows while date changes reorder them', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [row('a'), row('b')]);
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['b', 'a']);
  index.update('2', ['a'], [{ ...row('a'), rating: 5 }]);
  assert.deepEqual(index.page({ rating: 5 }, 'chronologicalAt', 'desc', 10, 0), ['a']);
  index.update('3', ['a'], [row('a', '2026-12-01T00:00:00Z')]);
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['a', 'b']);
});

test('database Date objects retain milliseconds for order and update invalidation', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  const a = {
    ...row('a'),
    libraryAddedAt: new Date('2026-11-01T00:00:00.001Z'),
    chronologicalAt: new Date('2026-11-01T00:00:00.001Z'),
  };
  const z = {
    ...row('z'),
    libraryAddedAt: new Date('2026-11-01T00:00:00.000Z'),
    chronologicalAt: new Date('2026-11-01T00:00:00.000Z'),
  };
  index.replace('1', [a, z]);
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['a', 'z']);
  index.update('2', ['z'], [{ ...z, chronologicalAt: new Date('2026-11-01T00:00:00.002Z') }]);
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['z', 'a']);
});

test('a query snapshot keeps one revision while later publications replace, insert and delete rows', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [row('a'), row('b')]);
  index.page({}, 'chronologicalAt', 'desc', 0, 0);
  const snapshot = index.snapshot();
  index.update('2', ['a', 'b', 'c'], [{ ...row('a'), rating: 4 }, row('c')]);
  assert.equal(snapshot.revision, '1');
  assert.equal(snapshot.count({ rating: null }), 2);
  assert.deepEqual(snapshot.page({}, 'chronologicalAt', 'desc', 10, 0), ['b', 'a']);
  assert.deepEqual(index.page({}, 'chronologicalAt', 'desc', 10, 0), ['c', 'a']);
  assert.equal(index.count({ rating: 4 }), 1);
});
