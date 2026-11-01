import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from '../eagle/eagle-memory-index';
import { residentPersonCounts } from './photo-people-memory';

test('person counts include each visible current photo once and update without counting stale faces', () => {
  const row = (id: string) => ({ id, ownerId: 'owner', libraryMode: 'PHOTO', isPrivate: false, deletedAt: null, mediaRevision: 2, libraryAddedAt: '2026-11-01T00:00:00Z', chronologicalAt: '2026-11-01T00:00:00Z', photoFaces: [{ personId: 'person', isCurrent: true, assetRevision: 2 }, { personId: 'person', isCurrent: true, assetRevision: 2 }] });
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [row('a'), { ...row('private'), isPrivate: true }, { ...row('stale'), mediaRevision: 3 }]);
  assert.deepEqual(residentPersonCounts(index, false), [{ id: 'person', photos: 1 }]);
  assert.deepEqual(residentPersonCounts(index, true), [{ id: 'person', photos: 2 }]);
  index.update('2', ['a'], [{ ...row('a'), photoFaces: [{ personId: 'other', isCurrent: true, assetRevision: 2 }] }]);
  assert.deepEqual(residentPersonCounts(index, false), [{ id: 'other', photos: 1 }]);
});
