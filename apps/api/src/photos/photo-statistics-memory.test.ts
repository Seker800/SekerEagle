import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from '../eagle/eagle-memory-index';
import { residentStatisticsDaily } from './photo-statistics-memory';

test('resident daily counts preserve private visibility, image scope and unknown metadata', () => {
  const fact = { camera: 'Camera', raw_lens: 'Lens', lens_device: 'Camera', day: '2026-11-01' };
  const row = (id: string) => ({
    id,
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    mimeType: 'image/jpeg',
    isPrivate: false,
    deletedAt: null,
    libraryAddedAt: '2026-11-01T00:00:00Z',
    chronologicalAt: '2026-11-01T00:00:00Z',
    statisticsFact: fact,
  });
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace('1', [
    row('a'),
    row('b'),
    { ...row('private'), isPrivate: true },
    { ...row('unknown'), statisticsFact: null },
    { ...row('video'), mimeType: 'video/mp4' },
  ]);
  const total = (privateVisible: boolean) =>
    residentStatisticsDaily(index, privateVisible).reduce((sum, entry) => sum + entry.n, 0);
  assert.equal(total(false), 3);
  assert.equal(total(true), 4);
  assert.equal(residentStatisticsDaily(index, false).find((entry) => entry.day === null)?.n, 1);
  index.update('2', ['a'], [{ ...row('a'), isPrivate: true }]);
  assert.equal(total(false), 2);
  index.update('3', ['b'], [{ ...row('b'), statisticsFact: { ...fact, camera: 'Other' } }]);
  assert.equal(
    residentStatisticsDaily(index, false).find((entry) => entry.camera === 'Other')?.n,
    1,
  );
});
