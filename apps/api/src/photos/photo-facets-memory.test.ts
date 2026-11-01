import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from '../eagle/eagle-memory-index';
import { residentPhotoFacets } from './photo-facets-memory';

test('resident facets retain raw values and original visibility without treating whitespace as empty', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace(
    '1',
    [
      { cameraModel: 'Camera', lensModel: 'Lens' },
      { cameraModel: '  ', lensModel: '' },
      { cameraModel: '', lensModel: null },
      { cameraModel: 'Private', lensModel: 'Secret', private: true },
    ].map((metadata, at) => ({
      id: String(at),
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      isPrivate: metadata.private ?? false,
      deletedAt: null,
      photoMetadata: metadata,
      chronologicalAt: new Date(0),
      libraryAddedAt: new Date(0),
    })),
  );
  assert.deepEqual(residentPhotoFacets(index, false), {
    cameras: ['Camera', '  '],
    lenses: ['Lens'],
  });
  assert.deepEqual(residentPhotoFacets(index, true), {
    cameras: ['Camera', '  ', 'Private'],
    lenses: ['Lens', 'Secret'],
  });
});
