import type { PhotoEdits } from './photo-editor-model';
import { findWatermark, photoWatermarkLayout, type PhotoMetadata } from './photo-watermark-model';
import { paintWatermark } from './photo-watermark-layouts';

/** Shared, flat compositor for thumbnails, live preview and full-resolution export. */
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
  const overlay = !!template.overlay;
  const dark = edits.watermarkTheme === 'black';
  const background = dark ? '#141414' : '#ffffff';
  const foreground = overlay ? (dark ? '#000000' : '#ffffff') : dark ? '#ffffff' : '#000000';
  const secondary = foreground;
  if (!overlay) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, layout.x, layout.y);
  context.save();
  context.globalAlpha = 1;
  const camera = (edits.watermarkCamera ?? metadata.camera ?? '').trim();
  paintWatermark({
    context,
    layout,
    template,
    edits,
    metadata,
    camera,
    details: edits.watermarkShowParameters
      ? (edits.watermarkParameters ?? metadata.parameters ?? '').trim()
      : '',
    time:
      edits.watermarkShowTime && template.time
        ? (edits.watermarkCapturedAt ?? metadata.capturedAt ?? '').trim()
        : '',
    website: edits.watermarkShowWebsite ? edits.watermarkWebsite.trim() : '',
    foreground,
    secondary,
    size: Math.max(1, source.width * 0.028),
  });
  context.restore();
  return canvas;
}
