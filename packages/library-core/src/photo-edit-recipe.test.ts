import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PHOTO_EDITS,
  readPhotoEditRecipe,
  selectPhotoEditParts,
} from './photo-edit-recipe';
test('recipe round trips every adjustment and rejects unsupported or unsafe data', () => {
  const recipe = {
    version: 1,
    edits: { ...DEFAULT_PHOTO_EDITS, exposure: 25, watermark: 'bottom', filter: 'lut:personal' },
  };
  assert.equal(readPhotoEditRecipe(recipe).edits.exposure, 25);
  for (const invalid of [
    { ...recipe, version: 2 },
    { ...recipe, edits: { ...recipe.edits, exposure: Infinity } },
    { ...recipe, edits: { ...recipe.edits, ownerId: 'victim' } },
    { ...recipe, edits: { ...recipe.edits, watermarkWebsite: 'x'.repeat(2001) } },
  ]) {
    assert.throws(() => readPhotoEditRecipe(invalid));
  }
});
test('batch selection preserves target crop and uses its own camera metadata', () => {
  const source = {
    ...DEFAULT_PHOTO_EDITS,
    exposure: 20,
    rotation: 90,
    cropZoom: 2,
    filter: 'vintage' as const,
    watermarkCamera: 'Wrong camera',
    watermarkCapturedAt: 'Wrong time',
    watermarkWebsite: 'example.com',
  };
  const target = { ...DEFAULT_PHOTO_EDITS, rotation: 180, cropZoom: 1.5 };
  const edits = selectPhotoEditParts(source, target, {
    adjustments: true,
    filter: true,
    watermark: true,
    crop: false,
  });
  assert.equal(edits.rotation, 180);
  assert.equal(edits.cropZoom, 1.5);
  assert.equal(edits.exposure, 20);
  assert.equal(edits.filter, 'vintage');
  assert.equal(edits.watermarkCamera, null);
  assert.equal(edits.watermarkCapturedAt, null);
  assert.equal(edits.watermarkWebsite, 'example.com');
});
