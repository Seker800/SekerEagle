import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOwnedObjectKey, createAssetObjectKey } from './object-key';

const ownerId = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';

void test('object keys are server-generated beneath the owner prefix', () => {
  const key = createAssetObjectKey(ownerId, '../../Secret File.JPG');
  assert.match(
    key,
    /^users\/5a1fd7d1-fd57-4e42-83f7-55425ca8704a\/assets\/[0-9a-f-]+\/secret-file.jpg$/,
  );
  assert.doesNotThrow(() => assertOwnedObjectKey(ownerId, key));
});

void test('cross-owner object keys fail closed', () => {
  assert.throws(() => assertOwnedObjectKey(ownerId, 'users/other/assets/id/original'));
  assert.throws(() => createAssetObjectKey('not-an-owner-id'));
});
