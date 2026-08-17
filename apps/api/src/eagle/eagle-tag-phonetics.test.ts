import assert from 'node:assert/strict';
import test from 'node:test';
import { createEagleTagPhonetics } from './eagle-tag-phonetics';

test('creates searchable full pinyin and initials for Chinese tag names', () => {
  assert.deepEqual(createEagleTagPhonetics('产品设计'), {
    pinyin: 'chanpinsheji',
    pinyinInitials: 'cpsj',
  });
});

test('normalizes Latin tag names for the same search projection', () => {
  assert.deepEqual(createEagleTagPhonetics(' UI Kit '), {
    pinyin: 'uikit',
    pinyinInitials: 'uikit',
  });
});
