import type { PhotoEdits } from './photo-editor-model';
import { findWatermark, photoWatermarkLayout, type PhotoMetadata } from './photo-watermark-model';

function fittedText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  const characters = Array.from(value.slice(0, 200));
  if (context.measureText(characters.join('')).width <= maxWidth) return characters.join('');
  while (characters.length && context.measureText(`${characters.join('')}…`).width > maxWidth)
    characters.pop();
  return characters.length ? `${characters.join('')}…` : '';
}

/** One compositor for thumbnails, live preview and full-resolution export. */
export function renderPhotoWatermark(
  source: HTMLCanvasElement,
  edits: PhotoEdits,
  metadata: PhotoMetadata = {},
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): HTMLCanvasElement {
  const template = findWatermark(edits.watermark);
  if (!template) return source;
  const layout = photoWatermarkLayout(source.width, source.height, template);
  if (layout.width * layout.height > 48_000_000 || Math.max(layout.width, layout.height) > 16384)
    throw new Error('WATERMARK_OUTPUT_TOO_LARGE');
  const canvas = createCanvas();
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  const overlay = template.style === 'overlay';
  const dark = ['film', 'dark'].includes(template.style) || edits.watermarkTheme === 'black';
  const foreground = overlay
    ? edits.watermarkTheme === 'black' && template.theme
      ? '#151515'
      : '#ffffff'
    : dark
      ? '#f5f5f5'
      : '#171717';
  const secondary = dark || overlay ? '#c6c6c6' : '#777777';
  if (!overlay) {
    context.fillStyle = dark ? '#141414' : '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, layout.x, layout.y);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(100, edits.watermarkOpacity)) / 100;
  const size = Math.max(
    1,
    source.width * 0.028 * Math.max(0.6, Math.min(1.6, edits.watermarkScale / 100)),
  );
  const detailSize = size * 0.48;
  const camera = edits.watermarkCamera.trim() || metadata.camera || '';
  const title = [camera || 'SEKER', edits.watermarkText.trim()].filter(Boolean).join('  ·  ');
  const details = [
    edits.watermarkShowParameters ? metadata.parameters : '',
    edits.watermarkShowTime && template.time ? metadata.capturedAt : '',
  ]
    .filter(Boolean)
    .join('   |   ');
  const family = template.style === 'film' ? 'monospace' : 'system-ui, sans-serif';
  const text = (
    value: string,
    x: number,
    y: number,
    fontSize: number,
    color: string,
    maxWidth: number,
    bold = false,
  ) => {
    context.font = `${bold ? '600' : '400'} ${fontSize}px ${family}`;
    context.fillStyle = color;
    context.fillText(fittedText(context, value, maxWidth), x, y);
  };
  if (template.style === 'side') {
    context.translate(layout.x + source.width + layout.caption / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.textAlign = 'center';
    text(title, 0, -size * 0.12, size, foreground, canvas.height * 0.84, true);
    text(details, 0, size * 0.8, detailSize, secondary, canvas.height * 0.84);
    if (template.accent) {
      context.fillStyle = '#dfaa56';
      context.fillRect(
        -canvas.height * 0.2,
        size * 1.25,
        canvas.height * 0.4,
        Math.max(1, size * 0.06),
      );
    }
  } else {
    const left = source.width * 0.04 + layout.x;
    const right = layout.x + source.width * 0.96;
    context.textAlign = template.align;
    const x =
      template.align === 'left' ? left : template.align === 'right' ? right : canvas.width / 2;
    const maxWidth = source.width * 0.88;
    const centerY = overlay
      ? source.height - size * (details ? 1.6 : 0.8)
      : layout.y + source.height + layout.caption * (template.style === 'poster' ? 0.48 : 0.44);
    if (overlay) {
      context.shadowColor = foreground === '#ffffff' ? '#000000aa' : '#ffffffaa';
      context.shadowBlur = size * 0.15;
      context.shadowOffsetY = size * 0.04;
    }
    if (template.accent) {
      context.fillStyle = '#dba54f';
      const lineWidth = size * 1.3;
      context.fillRect(
        template.align === 'center' ? x - lineWidth / 2 : x,
        centerY - size * 1.55,
        lineWidth,
        Math.max(1, size * 0.08),
      );
    }
    text(title, x, centerY, size, foreground, maxWidth, true);
    text(details, x, centerY + size * 0.85, detailSize, secondary, maxWidth);
    if (template.style === 'film') {
      context.fillStyle = '#d6b174';
      const slotWidth = source.width * 0.018,
        slotHeight = Math.max(1, layout.y * 0.35);
      for (let p = layout.x; p < canvas.width - slotWidth; p += source.width * 0.045) {
        context.fillRect(p, layout.y * 0.3, slotWidth, slotHeight);
        context.fillRect(p, canvas.height - slotHeight * 1.7, slotWidth, slotHeight);
      }
    }
  }
  context.restore();
  return canvas;
}
