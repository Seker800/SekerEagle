import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageEdit, validateImageEdit, imageEditPixels, imageEditSize } from './image-edit';

test('image edits crop in oriented source coordinates before rotation', () => {
  const edit = { ...createImageEdit(), crop: { x: .25, y: 0, width: .5, height: 1 }, rotation: 90 as const };
  assert.deepEqual(imageEditPixels(edit, 400, 200), { left: 100, top: 0, width: 200, height: 200 });
  assert.deepEqual(imageEditSize(edit, 400, 200), { width: 200, height: 200 });
  assert.deepEqual(imageEditSize({ ...createImageEdit(), rotation: 90 }, 400, 200), { width: 200, height: 400 });
});

test('invalid or unbounded recipes fail closed instead of silently clamping', () => {
  const edit = createImageEdit();
  for (const invalid of [
    { ...edit, rotation: 45 }, { ...edit, brightness: Infinity },
    { ...edit, saturation: -1 }, { ...edit, contrast: 4 },
    { ...edit, flipX: 'true' }, { ...edit, crop: { x: .8, y: 0, width: .5, height: 1 } },
    { ...edit, crop: { x: 0, y: 0, width: 0, height: 1 } },
    { ...edit, crop: null }, { ...edit, ownerId: 'other' },
  ]) assert.throws(() => validateImageEdit(invalid));
  assert.doesNotThrow(() => validateImageEdit(edit));
  assert.deepEqual(imageEditPixels(edit, 1, 1), { left: 0, top: 0, width: 1, height: 1 });
});
