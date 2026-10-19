import { expect, it } from 'vitest';
import {
  DEFAULT_PHOTO_EDITS,
  photoCrop,
  FIXED_CROP_RATIOS,
  type PhotoEdits,
} from './photo-editor-model';
import { dragPhotoCrop, type CropHandle } from './photo-editor-crop-geometry';

it('free edges change one dimension and corners change both while preserving the opposite anchor', () => {
  const edits: PhotoEdits = { ...DEFAULT_PHOTO_EDITS, cropRatio: 'free' };
  const right = photoCrop(2000, 1200, {
    ...edits,
    ...dragPhotoCrop(2000, 1200, edits, 'e', -500, -500),
  });
  expect([right.x, right.y, right.width, right.height]).toEqual([0, 0, 1500, 1200]);
  const corner = photoCrop(2000, 1200, {
    ...edits,
    ...dragPhotoCrop(2000, 1200, edits, 'nw', 400, 300),
  });
  expect([corner.x, corner.y, corner.width, corner.height]).toEqual([400, 300, 1600, 900]);
});

it('repeated free side drags preserve the untouched dimension without accumulating rounding drift', () => {
  let edits: PhotoEdits = {
    ...DEFAULT_PHOTO_EDITS,
    cropRatio: 'free',
    cropAspect: 2.389,
    cropZoom: 1.37,
  };
  const before = photoCrop(6000, 2696, edits);
  for (let i = 0; i < 30; i++) {
    edits = { ...edits, ...dragPhotoCrop(6000, 2696, edits, 'e', i % 2 ? 37.3 : -37.3, 0) };
    expect(photoCrop(6000, 2696, edits).height).toBe(before.height);
  }
});

it('all handles keep every fixed ratio and quarter-turn inside the photo at drag extremes', () => {
  const handles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'move'];
  for (const cropRatio of [...FIXED_CROP_RATIOS, 'free'] as const) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const handle of handles) {
        for (const delta of [-10000, -100, 100, 10000]) {
          const edits: PhotoEdits = { ...DEFAULT_PHOTO_EDITS, cropRatio, rotation, cropZoom: 2 };
          const before = photoCrop(2000, 1200, edits);
          const after = photoCrop(2000, 1200, {
            ...edits,
            ...dragPhotoCrop(2000, 1200, edits, handle, delta, -delta),
          });
          expect(after.width).toBeGreaterThan(0);
          expect(after.height).toBeGreaterThan(0);
          expect(after.x).toBeGreaterThanOrEqual(0);
          expect(after.y).toBeGreaterThanOrEqual(0);
          expect(after.x + after.width).toBeLessThanOrEqual(after.orientedWidth);
          expect(after.y + after.height).toBeLessThanOrEqual(after.orientedHeight);
          if (cropRatio !== 'free') {
            const base = photoCrop(2000, 1200, { ...edits, cropZoom: 1 });
            expect(Math.abs(after.width - (after.height * base.width) / base.height)).toBeLessThan(
              2,
            );
          }
          if (handle === 'move')
            expect([after.width, after.height]).toEqual([before.width, before.height]);
        }
      }
    }
  }
});

it('fixed corner resizing preserves the opposite corner and side resizing preserves its opposite edge', () => {
  const edits: PhotoEdits = { ...DEFAULT_PHOTO_EDITS, cropRatio: '4:3', cropZoom: 2 };
  const before = photoCrop(2000, 1200, edits);
  const corner = photoCrop(2000, 1200, {
    ...edits,
    ...dragPhotoCrop(2000, 1200, edits, 'nw', 100, 75),
  });
  expect(corner.x + corner.width).toBe(before.x + before.width);
  expect(corner.y + corner.height).toBe(before.y + before.height);
  const side = photoCrop(2000, 1200, {
    ...edits,
    ...dragPhotoCrop(2000, 1200, edits, 'e', -100, 0),
  });
  expect(side.x).toBe(before.x);
  expect(Math.abs(side.y + side.height / 2 - before.y - before.height / 2)).toBeLessThanOrEqual(1);
});
