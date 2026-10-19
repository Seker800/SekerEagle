import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { renderPhotoWatermark } from './photo-editor-watermark';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
import { WATERMARK_TEMPLATES, photoWatermarkLayout } from './photo-watermark-model';
import { drawPhoto } from './photo-editor-render';
import { formatPhotoMetadata } from './photo-editor-metadata';

const asHTML = (canvas: Canvas) => canvas as unknown as HTMLCanvasElement;
const create = () => asHTML(createCanvas(1, 1));
function source() {
  const canvas = createCanvas(240, 150),
    context = canvas.getContext('2d');
  context.fillStyle = '#4477aa';
  context.fillRect(0, 0, 240, 150);
  context.fillStyle = '#cc6622';
  context.fillRect(0, 0, 60, 40);
  return canvas;
}
const pixel = (canvas: HTMLCanvasElement, x: number, y: number) =>
  Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);

describe('real canvas watermark composition', () => {
  it('leaves the original photo untouched when no watermark is selected', () => {
    const photo = source();
    expect(renderPhotoWatermark(asHTML(photo), DEFAULT_PHOTO_EDITS, {}, create)).toBe(photo);
  });
  it('renders every template, preserves source photo pixels, and round-trips the saved PNG', async () => {
    const photo = source();
    for (const template of WATERMARK_TEMPLATES) {
      const edits = {
        ...DEFAULT_PHOTO_EDITS,
        watermark: template.id,
        watermarkText: 'Photo by Seker',
      };
      const composed = renderPhotoWatermark(
        asHTML(photo),
        edits,
        { camera: 'Nikon D80', parameters: '24mm · f/4' },
        create,
      );
      const layout = photoWatermarkLayout(photo.width, photo.height, template);
      expect([composed.width, composed.height]).toEqual([layout.width, layout.height]);
      expect(pixel(composed, layout.x + 3, layout.y + 3)).toEqual([204, 102, 34, 255]);
      const output = composed as unknown as Canvas;
      const decoded = await loadImage(output.toBuffer('image/png'));
      const roundTrip = createCanvas(output.width, output.height);
      roundTrip.getContext('2d').drawImage(decoded, 0, 0);
      const actual = roundTrip
        .getContext('2d')
        .getImageData(0, 0, output.width, output.height).data;
      const expected = output.getContext('2d').getImageData(0, 0, output.width, output.height).data;
      expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected))).toBe(0);
    }
    expect(Array.from(photo.getContext('2d').getImageData(3, 3, 1, 1).data)).toEqual([
      204, 102, 34, 255,
    ]);
  });
  it('changes frame themes without tinting the source or losing original resolution', () => {
    const photo = source();
    const white = renderPhotoWatermark(
      asHTML(photo),
      { ...DEFAULT_PHOTO_EDITS, watermark: 'frame-minimal' },
      {},
      create,
    );
    const black = renderPhotoWatermark(
      asHTML(photo),
      { ...DEFAULT_PHOTO_EDITS, watermark: 'frame-minimal', watermarkTheme: 'black' },
      {},
      create,
    );
    expect(pixel(white, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(black, 0, 0)).toEqual([20, 20, 20, 255]);
    const layout = photoWatermarkLayout(
      photo.width,
      photo.height,
      WATERMARK_TEMPLATES.find((t) => t.id === 'frame-minimal')!,
    );
    expect([layout.photoWidth, layout.photoHeight]).toEqual([photo.width, photo.height]);
    expect(pixel(white, layout.x + 120, layout.y + 75)).toEqual(
      pixel(black, layout.x + 120, layout.y + 75),
    );
  });
  it('composes after crop and rotation instead of cropping the caption or rotating twice', () => {
    const photo = source(),
      geometry = createCanvas(1, 1);
    const edits = {
      ...DEFAULT_PHOTO_EDITS,
      rotation: 90,
      cropRatio: '1:1' as const,
      watermark: 'photo-strip',
    };
    drawPhoto(asHTML(geometry), asHTML(photo), edits);
    expect([geometry.width, geometry.height]).toEqual([150, 150]);
    const output = renderPhotoWatermark(asHTML(geometry), edits, {}, create);
    expect(output.width).toBeGreaterThan(150);
    expect(output.height).toBeGreaterThan(output.width);
  });
  it('preserves transparency for overlay watermarks and allows opacity to reach zero', () => {
    const photo = createCanvas(200, 120);
    const output = renderPhotoWatermark(
      asHTML(photo),
      { ...DEFAULT_PHOTO_EDITS, watermark: 'standard-left', watermarkOpacity: 0 },
      {},
      create,
    );
    expect(
      output
        .getContext('2d')!
        .getImageData(0, 0, 200, 120)
        .data.every((value) => value === 0),
    ).toBe(true);
  });
});

describe('photographic metadata whitelist', () => {
  it('formats real parameters and capture time while ignoring GPS and unknown fields', () => {
    expect(
      formatPhotoMetadata({
        Make: 'Nikon',
        Model: 'Nikon D80',
        FocalLength: 24,
        FNumber: 4,
        ExposureTime: 1 / 125,
        ISO: 200,
        DateTimeOriginal: new Date(2026, 9, 19, 10, 30),
        GPSLatitude: 12,
        GPSLongitude: 34,
        ownerId: 'external',
      }),
    ).toEqual({
      camera: 'Nikon D80',
      parameters: '24mm  ·  f/4  ·  1/125s  ·  ISO 200',
      capturedAt: '2026.10.19 10:30',
    });
  });
  it('does not invent a camera, capture time or parameters for stripped photos', () => {
    expect(formatPhotoMetadata(undefined)).toEqual({});
    expect(
      formatPhotoMetadata({ Model: '', FNumber: NaN, ISO: -1, DateTimeOriginal: 'not a date' }),
    ).toEqual({ camera: undefined, parameters: undefined, capturedAt: undefined });
  });
});
