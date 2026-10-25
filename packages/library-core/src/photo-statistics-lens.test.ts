import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePhotoLensKey } from './photo-statistics-lens';

test('typed lens identities preserve names without merging real lenses and device fallbacks', () => {
  for (const kind of ['lens', 'camera', 'unknown']) {
    const name = kind === 'unknown' ? '' : 'Phone A';
    assert.deepEqual(parsePhotoLensKey(JSON.stringify([kind, name])), [kind, name]);
  }
  const name = '["camera","Phone A"]';
  assert.deepEqual(parsePhotoLensKey(JSON.stringify(['lens', name])), ['lens', name]);
  for (const key of [
    'Old lens',
    '{}',
    'null',
    '[]',
    '["lens"]',
    '["camera",1]',
    '["bad","a"]',
    '["unknown","a"]',
    '["lens",""]',
    '["lens","a",0]',
  ]) {
    assert.equal(parsePhotoLensKey(key), null);
  }
});
