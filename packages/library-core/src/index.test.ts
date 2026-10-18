import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLibraryScope, parseLibraryMode, libraryScopeKey, sameLibraryScope } from './index';

test('legacy scope is material, with a frozen owner and mode', () => {
  const scope = createLibraryScope('owner-a');
  assert.deepEqual(scope, { ownerId: 'owner-a', libraryMode: 'MATERIAL' });
  assert.equal(Object.isFrozen(scope), true);
});

test('explicit photos cannot alias materials or another owner', () => {
  const material = createLibraryScope('owner-a');
  const photo = createLibraryScope('owner-a', 'PHOTO');
  assert.equal(sameLibraryScope(material, photo), false);
  assert.equal(sameLibraryScope(photo, createLibraryScope('owner-b', 'PHOTO')), false);
  assert.equal(sameLibraryScope(photo, createLibraryScope('owner-a', 'PHOTO')), true);
  assert.notEqual(libraryScopeKey(material), libraryScopeKey(photo));
});

test('cache scope keys are unambiguous for arbitrary owner strings', () => {
  assert.notEqual(
    libraryScopeKey(createLibraryScope('a:PHOTO')),
    libraryScopeKey(createLibraryScope('a', 'PHOTO')),
  );
});

test('invalid explicit modes fail closed rather than falling back to material', () => {
  for (const value of ['', 'photo', 'ALL', null, {}, ['PHOTO']]) {
    assert.throws(() => parseLibraryMode(value));
  }
  assert.equal(parseLibraryMode(undefined), 'MATERIAL');
  assert.equal(parseLibraryMode('PHOTO'), 'PHOTO');
  assert.equal(parseLibraryMode('MATERIAL'), 'MATERIAL');
});

test('empty owner is rejected and incoming scope cannot be mutated', () => {
  assert.throws(() => createLibraryScope(''));
  const scope = createLibraryScope('owner-a', 'PHOTO');
  assert.throws(() => Object.assign(scope, { libraryMode: 'MATERIAL' }));
  assert.equal(scope.libraryMode, 'PHOTO');
});
