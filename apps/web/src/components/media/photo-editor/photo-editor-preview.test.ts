import { expect, it } from 'vitest';
import { DEFAULT_PHOTO_EDITS, type PhotoEdits } from './photo-editor-model';
import { photoPreviewKey, photoProcessedKey } from './photo-editor-preview';

const base = (patch: Partial<PhotoEdits> = {}): PhotoEdits => ({
  ...DEFAULT_PHOTO_EDITS,
  ...patch,
});
const cropView = { compare: false, tab: 'crop', metadata: {} };
const adjustView = { compare: false, tab: 'adjust', metadata: {} };

it('keeps the crop workspace bitmap unchanged while moving, zooming or straightening', () => {
  const held = photoPreviewKey(base(), cropView);
  expect(photoPreviewKey(base({ cropX: 0.3 }), cropView)).toBe(held);
  expect(photoPreviewKey(base({ cropY: 0.7 }), cropView)).toBe(held);
  expect(photoPreviewKey(base({ cropZoom: 2 }), cropView)).toBe(held);
  expect(photoPreviewKey(base({ cropAspect: 0.5 }), cropView)).toBe(held);
  expect(photoPreviewKey(base({ straighten: 12.5 }), cropView)).toBe(held);
  expect(photoProcessedKey(base({ cropX: 0.3, straighten: 12.5 }))).toBe(photoProcessedKey(base()));
});

it('rasterizes quarter turns, mirroring and comparison in the crop workspace', () => {
  const held = photoPreviewKey(base(), cropView);
  expect(photoPreviewKey(base({ rotation: 90 }), cropView)).not.toBe(held);
  expect(photoPreviewKey(base({ flip: true }), cropView)).not.toBe(held);
  expect(photoPreviewKey(base(), { ...cropView, compare: true })).not.toBe(held);
});

it('still reprocesses grain and vignette against crop geometry', () => {
  expect(photoProcessedKey(base({ grain: 40, cropX: 0.3 }))).not.toBe(
    photoProcessedKey(base({ grain: 40 })),
  );
  expect(photoPreviewKey(base({ vignette: 30, cropZoom: 2 }), cropView)).not.toBe(
    photoPreviewKey(base({ vignette: 30 }), cropView),
  );
});

it('changes the finished preview for every crop adjustment', () => {
  const held = photoPreviewKey(base(), adjustView);
  expect(photoPreviewKey(base({ cropX: 0.3 }), adjustView)).not.toBe(held);
  expect(photoPreviewKey(base({ cropZoom: 2 }), adjustView)).not.toBe(held);
  expect(photoPreviewKey(base({ straighten: 8 }), adjustView)).not.toBe(held);
  expect(photoPreviewKey(base({ watermark: 'bottom' }), adjustView)).not.toBe(held);
});
