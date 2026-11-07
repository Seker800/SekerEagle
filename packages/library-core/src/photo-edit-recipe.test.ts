import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PHOTO_EDITS,
  photoEditRecipe,
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
test('straighten accepts fractional degrees within 45 and defaults for old recipes', () => {
  const recipe = {
    version: 1,
    edits: { ...DEFAULT_PHOTO_EDITS, straighten: -12.5 },
  };
  assert.equal(readPhotoEditRecipe(recipe).edits.straighten, -12.5);
  const legacy = { ...recipe.edits };
  delete (legacy as Partial<typeof legacy>).straighten;
  assert.equal(readPhotoEditRecipe({ version: 1, edits: legacy }).edits.straighten, 0);
  for (const invalid of [-45.1, 45.1, Number.NaN, '3'])
    assert.throws(
      () =>
        readPhotoEditRecipe({
          version: 1,
          edits: { ...DEFAULT_PHOTO_EDITS, straighten: invalid },
        }),
      /INVALID_EDIT_RECIPE/,
    );
});

test('serialized recipes omit the straighten default for older clients', () => {
  assert.equal('straighten' in photoEditRecipe(DEFAULT_PHOTO_EDITS).edits, false);
  assert.equal(photoEditRecipe({ ...DEFAULT_PHOTO_EDITS, straighten: 4.2 }).edits.straighten, 4.2);
  assert.equal(
    readPhotoEditRecipe(photoEditRecipe({ ...DEFAULT_PHOTO_EDITS, straighten: 4.2 })).edits
      .straighten,
    4.2,
  );
});

test('batch crop selection carries straighten with the crop group', () => {
  const source = { ...DEFAULT_PHOTO_EDITS, straighten: 8, rotation: 90 };
  const target = { ...DEFAULT_PHOTO_EDITS, straighten: -2 };
  assert.equal(
    selectPhotoEditParts(source, target, {
      adjustments: true,
      filter: true,
      watermark: true,
      crop: true,
    }).straighten,
    8,
  );
  assert.equal(
    selectPhotoEditParts(source, target, {
      adjustments: true,
      filter: true,
      watermark: true,
      crop: false,
    }).straighten,
    -2,
  );
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
