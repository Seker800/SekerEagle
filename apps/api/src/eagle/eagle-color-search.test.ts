import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLOR_PROCESSOR_VERSION,
  buildColorMatchWhere,
  normalizeHexColor,
} from './eagle-color-search';

test('normalizes a valid hex color and rejects invalid input', () => {
  assert.equal(normalizeHexColor(' #2E86AB '), '#2e86ab');
  assert.throws(() => normalizeHexColor('blue'), /颜色筛选值无效/);
  assert.throws(() => normalizeHexColor('#1234'), /颜色筛选值无效/);
});

test('uses the exact SQL color predicate and a shared processor version', () => {
  assert.equal(COLOR_PROCESSOR_VERSION, 'color-v4-eagle-basic');
  assert.deepEqual(buildColorMatchWhere(' #2E86AB '), { colorMatch: '#2e86ab' });
});
