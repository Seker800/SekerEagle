import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawPhoto } from './photo-editor-render';
import { DEFAULT_PHOTO_EDITS, photoCrop, type PhotoEdits } from './photo-editor-model';

// Geometry fixtures deliberately use known corner colors, not subjective image matching.
function fixture(width = 200, height = 120) {
  const source = createCanvas(width, height);
  const ctx = source.getContext('2d');
  for (const [color, x, y] of [
    ['#ff0000', 0, 0],
    ['#00ff00', width / 2, 0],
    ['#0000ff', 0, height / 2],
    ['#ffff00', width / 2, height / 2],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width / 2, height / 2);
  }
  return source;
}
function draw(edits = DEFAULT_PHOTO_EDITS, source = fixture()) {
  const target = createCanvas(1, 1);
  drawPhoto(target as unknown as HTMLCanvasElement, source as unknown as HTMLCanvasElement, edits);
  return target;
}
function corners(canvas: Canvas) {
  const ctx = canvas.getContext('2d');
  return [
    [1, 1],
    [canvas.width - 2, 1],
    [1, canvas.height - 2],
    [canvas.width - 2, canvas.height - 2],
  ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
}
const R = [255, 0, 0, 255],
  G = [0, 255, 0, 255],
  B = [0, 0, 255, 255],
  Y = [255, 255, 0, 255];
describe('saved photo geometry uses the exact result-preview rendering path', () => {
  it('zooms in original aspect ratio and keeps the same source region at preview and save sizes', () => {
    const edits = { ...DEFAULT_PHOTO_EDITS, cropZoom: 2, cropX: 1, cropY: 0 };
    const full = draw(edits, fixture(2000, 1200));
    const preview = draw(edits);
    expect([full.width, full.height]).toEqual([1000, 600]);
    expect([preview.width, preview.height]).toEqual([100, 60]);
    expect(corners(full)).toEqual([G, G, G, G]);
    expect(corners(preview)).toEqual(corners(full));
  });
  it.each([0, 90, 180, 270])(
    'keeps zoomed crops within image coverage after %s degree rotation',
    (rotation) => {
      for (const cropZoom of [1, 1.7, 4, 99]) {
        const edits = {
          ...DEFAULT_PHOTO_EDITS,
          cropRatio: '3:4' as const,
          rotation,
          cropZoom,
          cropX: -5,
          cropY: 5,
        };
        const region = photoCrop(2000, 1200, edits);
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.x + region.width).toBeLessThanOrEqual(region.orientedWidth);
        expect(region.y + region.height).toBeLessThanOrEqual(region.orientedHeight);
        const result = draw(edits);
        expect(corners(result).every((pixel) => pixel[3] === 255)).toBe(true);
      }
    },
  );
  it('does not crop or rotate when only tonal adjustments are selected', () => {
    const result = draw({ ...DEFAULT_PHOTO_EDITS, exposure: 0.2, saturation: 30 });
    expect([result.width, result.height]).toEqual([200, 120]);
    expect(corners(result)).toEqual([R, G, B, Y]);
  });
  it('preserves original dimensions even when aspect-ratio division has floating-point rounding', () => {
    const result = draw(DEFAULT_PHOTO_EDITS, fixture(186, 198));
    expect([result.width, result.height]).toEqual([186, 198]);
  });
  it.each([
    [90, [B, R, Y, G]],
    [180, [Y, B, G, R]],
    [270, [G, Y, R, B]],
  ])('rotates exactly once at %s degrees', (rotation, expected) => {
    const result = draw({ ...DEFAULT_PHOTO_EDITS, rotation: rotation as number });
    expect(corners(result)).toEqual(expected);
    expect([result.width, result.height]).toEqual(rotation === 180 ? [200, 120] : [120, 200]);
  });
  it('mirrors horizontally without silently rotating', () => {
    expect(corners(draw({ ...DEFAULT_PHOTO_EDITS, flip: true }))).toEqual([G, R, Y, B]);
  });
  it('applies the normalized crop after orientation at preview and full resolution', () => {
    const edits: PhotoEdits = {
      ...DEFAULT_PHOTO_EDITS,
      rotation: 90,
      cropRatio: '1:1',
      cropY: 0.5,
    };
    const full = draw(edits, fixture(2000, 1200));
    const preview = draw(edits, fixture(200, 120));
    expect([full.width, full.height]).toEqual([1200, 1200]);
    expect([preview.width, preview.height]).toEqual([120, 120]);
    expect(corners(full)).toEqual(corners(preview));
    expect(corners(full)).toEqual([B, R, Y, G]);
  });
  it('PNG encoding and reopening preserves the entire preview pixel buffer', async () => {
    for (const patch of [
      {},
      { rotation: 90 },
      { flip: true },
      { rotation: 90, cropRatio: '1:1' as const },
      { cropRatio: 'free' as const, cropAspect: 1.17, cropZoom: 2.2, cropX: 0.2, cropY: 0.7 },
      { rotation: 270, cropRatio: '3:4' as const, cropZoom: 2.4, cropX: 0.2, cropY: 0.8 },
    ]) {
      const preview = draw({ ...DEFAULT_PHOTO_EDITS, ...patch });
      const file = preview.toBuffer('image/png');
      const saved = await loadImage(file);
      const reopened = createCanvas(saved.width, saved.height);
      reopened.getContext('2d').drawImage(saved, 0, 0);
      expect([saved.width, saved.height]).toEqual([preview.width, preview.height]);
      expect(reopened.getContext('2d').getImageData(0, 0, saved.width, saved.height).data).toEqual(
        preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data,
      );
    }
  });
});
