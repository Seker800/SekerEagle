import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLOR_PROCESSOR_VERSION,
  buildColorAnalysisWhere,
  normalizeHexColor,
  rgbToLab,
} from './eagle-color-search';

test('normalizes a valid hex color and rejects invalid input', () => {
  assert.equal(normalizeHexColor(' #2E86AB '), '#2e86ab');
  assert.throws(() => normalizeHexColor('blue'), /颜色筛选值无效/);
  assert.throws(() => normalizeHexColor('#1234'), /颜色筛选值无效/);
});

test('builds a current-version perceptual color relation filter', () => {
  const target = rgbToLab(46, 134, 171);
  const where = buildColorAnalysisWhere('#2e86ab');

  assert.equal(COLOR_PROCESSOR_VERSION, 'color-v2');
  assert.equal(where.some.isCurrent, true);
  assert.equal(where.some.processorVersion, COLOR_PROCESSOR_VERSION);
  assert.equal(where.some.status, 'COMPLETED');
  assert.equal(where.some.swatches.some.weight.gte, 0.03);
  assert.ok(where.some.swatches.some.labL.gte < target.labL);
  assert.ok(where.some.swatches.some.labL.lte > target.labL);
  assert.ok(where.some.swatches.some.labA.gte < target.labA);
  assert.ok(where.some.swatches.some.labB.lte > target.labB);
});

