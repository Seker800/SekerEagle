import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import { renderPhotoWatermark } from './photo-editor-watermark';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
import { WATERMARK_TEMPLATES, photoWatermarkLayout, findWatermark } from './photo-watermark-model';
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
    expect(output.width).toBe(150);
    expect(output.height).toBeGreaterThan(output.width);
  });
  it('preserves transparent photo pixels when all overlay text is empty', () => {
    const photo = createCanvas(200, 120);
    const output = renderPhotoWatermark(
      asHTML(photo),
      { ...DEFAULT_PHOTO_EDITS, watermark: 'standard-left', watermarkShowWebsite: false },
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

describe('distinct and flat watermark layouts', () => {
  it('consolidates alignment variants into no more than nine structurally different layouts', () => {
    expect(WATERMARK_TEMPLATES.length).toBeLessThanOrEqual(9);
    expect(new Set(WATERMARK_TEMPLATES.map((template) => template.style)).size).toBe(
      WATERMARK_TEMPLATES.length,
    );
    for (const id of ['header-footer', 'color-block', 'corner-grid', 'editorial-panel'])
      expect(WATERMARK_TEMPLATES.some((template) => template.id === id)).toBe(true);
    expect(WATERMARK_TEMPLATES.map((template) => template.style)).not.toEqual(
      expect.arrayContaining(['instant', 'film', 'cinema', 'postcard', 'blueprint']),
    );
    const signatures = WATERMARK_TEMPLATES.map((template) => {
      const result = renderPhotoWatermark(
        asHTML(source()),
        {
          ...DEFAULT_PHOTO_EDITS,
          watermark: template.id,

          watermarkShowTime: true,
        },
        {
          camera: 'Nikon D80',
          parameters: '24mm · f/4 · 1/125s · ISO 200',
          capturedAt: '2026.10.19',
        },
        create,
      ) as unknown as Canvas;
      return result.toBuffer('image/png').toString('base64');
    });
    expect(new Set(signatures).size).toBe(WATERMARK_TEMPLATES.length);
  });
  it('never applies shadows to any watermark text, including overlays', () => {
    const shadowWrites: number[] = [];
    const factory = () => {
      const canvas = createCanvas(1, 1),
        context = canvas.getContext('2d');
      for (const key of ['shadowBlur', 'shadowOffsetX', 'shadowOffsetY'])
        Object.defineProperty(context, key, {
          configurable: true,
          set: (value: number) => {
            if (value) shadowWrites.push(value);
          },
          get: () => 0,
        });
      return asHTML(canvas);
    };
    for (const template of WATERMARK_TEMPLATES)
      renderPhotoWatermark(
        asHTML(source()),
        { ...DEFAULT_PHOTO_EDITS, watermark: template.id },
        { camera: 'Nikon D80' },
        factory,
      );
    expect(shadowWrites).toEqual([]);
  });
  it('keeps source photo geometry intact for portrait, panorama, transparent and tiny inputs', () => {
    for (const [width, height] of [
      [1, 1],
      [80, 240],
      [720, 80],
    ]) {
      const photo = createCanvas(width, height);
      photo.getContext('2d').fillStyle = '#4477aa';
      photo.getContext('2d').fillRect(0, 0, width, height);
      for (const template of WATERMARK_TEMPLATES) {
        const layout = photoWatermarkLayout(width, height, template);
        expect(layout.x).toBeGreaterThanOrEqual(0);
        expect(layout.y).toBeGreaterThanOrEqual(0);
        expect(layout.x + width).toBeLessThanOrEqual(layout.width);
        expect(layout.y + height).toBeLessThanOrEqual(layout.height);
        expect(() =>
          renderPhotoWatermark(
            asHTML(photo),
            {
              ...DEFAULT_PHOTO_EDITS,
              watermark: template.id,
              watermarkCamera: 'Long camera model '.repeat(100),
            },
            {},
            create,
          ),
        ).not.toThrow();
      }
    }
  });
});

it('resolves consolidated legacy layouts to canonical templates', () => {
  for (const [oldId, id] of Object.entries({
    'standard-right': 'standard-left',
    'classic-strip': 'photo-strip',
    'classic-frame': 'frame-minimal',
    'photo-poster': 'frame-minimal',
    'frame-poster': 'frame-minimal',
    'film-dark': 'header-footer',
    'sport-rail': 'photo-side',
    'sport-tag': 'standard-left',
  }))
    expect(findWatermark(oldId)?.id).toBe(id);
  expect(findWatermark('unknown')).toBeUndefined();
});

describe('watermark typography and content hierarchy', () => {
  function capture(id: string, align: 'left' | 'right' = 'left') {
    const photo = createCanvas(1600, 1000);
    const drawn: { text: string; size: number }[] = [];
    renderPhotoWatermark(
      asHTML(photo),
      {
        ...DEFAULT_PHOTO_EDITS,
        watermark: id,

        watermarkShowTime: true,
        watermarkAlign: align,
      },
      {
        camera: 'FUJIFILM X-E5',
        parameters: '35mm · f/2.8 · 1/250s · ISO 400',
        capturedAt: '2026.10.19',
      },
      () => {
        const canvas = createCanvas(1, 1);
        const context = canvas.getContext('2d');
        const original = context.fillText.bind(context);
        vi.spyOn(context, 'fillText').mockImplementation((text, x, y) => {
          drawn.push({ text, size: Number(context.font.match(/([\d.]+)px/)?.[1]) });
          original(text, x, y);
        });
        return asHTML(canvas);
      },
    );
    return drawn;
  }
  it('uses a compact photographic footer and keeps parameters readable', () => {
    const layout = photoWatermarkLayout(1600, 1000, findWatermark('photo-strip')!);
    expect(layout.panel.height).toBeLessThanOrEqual(160);
    const parameters = capture('photo-strip').find(({ text }) => text.includes('35mm'))!;
    expect(parameters.size).toBeGreaterThanOrEqual(25);
  });
  it('retains camera, parameters and date as distinct side-rail information', () => {
    const texts = capture('photo-side').map(({ text }) => text);
    for (const text of ['FUJIFILM X-E5', '2026.10.19']) expect(texts).toContain(text);
    expect(texts.some((text) => text.includes('35mm'))).toBe(true);
  });
  it('keeps the date visible for a right-aligned signature', () => {
    expect(capture('standard-left', 'right').map(({ text }) => text)).toContain('2026.10.19');
  });
});

it('keeps watermark text inside the output without collisions with fixed template sizes', () => {
  for (const [width, height] of [
    [1600, 1000],
    [1000, 1500],
    [1600, 400],
  ]) {
    for (const template of WATERMARK_TEMPLATES) {
      const boxes: { left: number; top: number; right: number; bottom: number }[] = [];
      const output = renderPhotoWatermark(
        asHTML(createCanvas(width, height)),
        {
          ...DEFAULT_PHOTO_EDITS,
          watermark: template.id,

          watermarkShowTime: true,
        },
        {
          camera: 'FUJIFILM X-E5',
          parameters: '35mm · f/2.8 · 1/250s · ISO 400',
          capturedAt: '2026.10.19 10:30',
        },
        () => {
          const canvas = createCanvas(1, 1),
            context = canvas.getContext('2d');
          const original = context.fillText.bind(context);
          vi.spyOn(context, 'fillText').mockImplementation((text, x, y) => {
            const metrics = context.measureText(text),
              matrix = context.getTransform();
            const corners = [
              [x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent],
              [x + metrics.actualBoundingBoxRight, y + metrics.actualBoundingBoxDescent],
              [x - metrics.actualBoundingBoxLeft, y + metrics.actualBoundingBoxDescent],
              [x + metrics.actualBoundingBoxRight, y - metrics.actualBoundingBoxAscent],
            ].map(([px, py]) => ({
              x: matrix.a * px + matrix.c * py + matrix.e,
              y: matrix.b * px + matrix.d * py + matrix.f,
            }));
            boxes.push({
              left: Math.min(...corners.map((p) => p.x)),
              right: Math.max(...corners.map((p) => p.x)),
              top: Math.min(...corners.map((p) => p.y)),
              bottom: Math.max(...corners.map((p) => p.y)),
            });
            original(text, x, y);
          });
          return asHTML(canvas);
        },
      );
      for (const [index, box] of boxes.entries()) {
        expect(box.left, template.id).toBeGreaterThanOrEqual(-1);
        expect(box.top, template.id).toBeGreaterThanOrEqual(-1);
        expect(box.right, template.id).toBeLessThanOrEqual(output.width + 1);
        expect(box.bottom, template.id).toBeLessThanOrEqual(output.height + 1);
        for (const other of boxes.slice(index + 1)) {
          const overlapWidth = Math.min(box.right, other.right) - Math.max(box.left, other.left);
          const overlapHeight = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
          expect(overlapWidth > 1 && overlapHeight > 1, `${template.id}: text collision`).toBe(
            false,
          );
        }
      }
    }
  }
});

it('composes an editable auxiliary website in every layout and respects its switch', () => {
  for (const template of WATERMARK_TEMPLATES) {
    for (const enabled of [true, false]) {
      const drawn: string[] = [];
      renderPhotoWatermark(
        asHTML(createCanvas(1600, 1000)),
        {
          ...DEFAULT_PHOTO_EDITS,
          watermark: template.id,
          watermarkWebsite: 'PHOTO.EXAMPLE.COM',
          watermarkShowWebsite: enabled,
        },
        {},
        () => {
          const canvas = createCanvas(1, 1),
            context = canvas.getContext('2d');
          vi.spyOn(context, 'fillText').mockImplementation((text) => {
            drawn.push(text);
          });
          return asHTML(canvas);
        },
      );
      expect(drawn.includes('PHOTO.EXAMPLE.COM'), template.id).toBe(enabled);
      expect(drawn).not.toContain('WWW.SEKER.WANG');
    }
  }
});

it('never invents a title, shows detected capture time by default and respects manual overrides', () => {
  const capture = (patch: Partial<typeof DEFAULT_PHOTO_EDITS>, metadata = {}) => {
    const texts: string[] = [];
    renderPhotoWatermark(
      asHTML(createCanvas(1600, 1000)),
      { ...DEFAULT_PHOTO_EDITS, watermark: 'photo-strip', ...patch },
      metadata,
      () => {
        const canvas = createCanvas(1, 1);
        vi.spyOn(canvas.getContext('2d'), 'fillText').mockImplementation((text) => {
          texts.push(text);
        });
        return asHTML(canvas);
      },
    );
    return texts;
  };
  expect(capture({})).toEqual(['WWW.SEKER.WANG']);
  const metadata = {
    camera: 'FUJIFILM X-E5',
    parameters: '35mm · f/2.8',
    capturedAt: '2026.10.19 10:30',
  };
  expect(capture({}, metadata)).toContain(metadata.capturedAt);
  expect(capture({ watermarkShowTime: false }, metadata)).not.toContain(metadata.capturedAt);
  const texts = capture(
    {
      watermarkCamera: 'Nikon Z5',
      watermarkParameters: '50mm · f/2',
      watermarkCapturedAt: '2026.10.18',
    },
    metadata,
  );
  for (const value of ['Nikon Z5', '50mm · f/2', '2026.10.18']) expect(texts).toContain(value);
  const cleared = capture(
    { watermarkCamera: '', watermarkParameters: '', watermarkCapturedAt: '' },
    metadata,
  );
  expect(cleared).toEqual(['WWW.SEKER.WANG']);
});

it('draws every watermark with one regular sans font, solid black or white and no effects', () => {
  for (const template of WATERMARK_TEMPLATES) {
    for (const theme of ['black', 'white'] as const) {
      const draws: {
        font: string;
        color: unknown;
        alpha: number;
        shadow: number;
        filter: string;
        blend: string;
      }[] = [];
      renderPhotoWatermark(
        asHTML(createCanvas(1600, 1000)),
        {
          ...DEFAULT_PHOTO_EDITS,
          watermark: template.id,
          watermarkTheme: theme,
        },
        { parameters: '135mm · f/5.6 · 1/500s · ISO 125', capturedAt: '2026.10.19' },
        () => {
          const canvas = createCanvas(1, 1),
            context = canvas.getContext('2d');
          vi.spyOn(context, 'strokeText').mockImplementation(() => {
            throw new Error('Text outline is forbidden');
          });
          vi.spyOn(context, 'fillText').mockImplementation(() => {
            draws.push({
              font: context.font,
              color: context.fillStyle,
              alpha: context.globalAlpha,
              shadow: context.shadowBlur,
              filter: context.filter,
              blend: context.globalCompositeOperation,
            });
          });
          return asHTML(canvas);
        },
      );
      expect(draws.length, template.id).toBeGreaterThan(0);
      for (const draw of draws) {
        expect(draw.font, template.id).toMatch(/^400 [\d.]+px system-ui, sans-serif$/);
        expect(['#000000', '#ffffff'], template.id).toContain(draw.color);
        expect(draw.alpha, template.id).toBe(1);
        expect(draw.shadow, template.id).toBe(0);
        expect(draw.filter, template.id).toBe('none');
        expect(draw.blend, template.id).toBe('source-over');
      }
    }
  }
});

it('keeps the detected camera in every layout with only camera, parameters, time and website', () => {
  for (const template of WATERMARK_TEMPLATES) {
    const texts: string[] = [];
    renderPhotoWatermark(
      asHTML(createCanvas(1600, 1000)),
      {
        ...DEFAULT_PHOTO_EDITS,
        watermark: template.id,
      },
      { camera: 'NIKON D80', parameters: '135mm · f/5.6' },
      () => {
        const canvas = createCanvas(1, 1);
        vi.spyOn(canvas.getContext('2d'), 'fillText').mockImplementation((text) => {
          texts.push(text);
        });
        return asHTML(canvas);
      },
    );
    expect(
      texts.some((text) => text.includes('NIKON D80')),
      template.id,
    ).toBe(true);
  }
});

it('ignores signature and font-size remnants from an existing edit session in every template', () => {
  for (const template of WATERMARK_TEMPLATES) {
    const photo = asHTML(source());
    const edits = { ...DEFAULT_PHOTO_EDITS, watermark: template.id };
    const legacy = { ...edits, watermarkText: 'Legacy signature', watermarkScale: 160 };
    const metadata = { camera: 'NIKON D80', parameters: '135mm · f/5.6', capturedAt: '2010.07.31' };
    const original = renderPhotoWatermark(photo, edits, metadata, create) as unknown as Canvas;
    const withLegacy = renderPhotoWatermark(photo, legacy, metadata, create) as unknown as Canvas;
    expect(
      withLegacy.toBuffer('image/png').equals(original.toBuffer('image/png')),
      template.id,
    ).toBe(true);
  }
});

it('renders a blurred photo-colored background while preserving every source pixel', () => {
  const photo = source();
  for (const template of WATERMARK_TEMPLATES.filter(
    (template) => template.theme && !template.overlay,
  )) {
    const edits = {
      ...DEFAULT_PHOTO_EDITS,
      watermark: template.id,
      watermarkTheme: 'frosted' as const,
      watermarkWebsite: '',
    };
    const output = renderPhotoWatermark(asHTML(photo), edits, {}, create);
    const layout = photoWatermarkLayout(photo.width, photo.height, template);
    const actual = output
      .getContext('2d')!
      .getImageData(layout.x, layout.y, photo.width, photo.height).data;
    const expected = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height).data;
    expect(Buffer.from(actual).equals(Buffer.from(expected)), template.id).toBe(true);
    const p = layout.panel;
    const sample = pixel(output, p.x + 2, p.y + 2);
    expect(sample, template.id).not.toEqual([255, 255, 255, 255]);
    expect(sample, template.id).not.toEqual([20, 20, 20, 255]);
    expect(sample[3]).toBe(255);
    const neighbor = pixel(output, p.x + 3, p.y + 2);
    expect(
      Math.max(...sample.map((value, index) => Math.abs(value - neighbor[index]))),
    ).toBeLessThan(12);
    const again = renderPhotoWatermark(asHTML(photo), edits, {}, create) as unknown as Canvas;
    expect(
      again.toBuffer('image/png').equals((output as unknown as Canvas).toBuffer('image/png')),
    ).toBe(true);
  }
});
