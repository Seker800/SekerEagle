import { t } from '../../../i18n';
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
  const overlay = template.style === 'overlay';
  const dark =
    ['film', 'cinema', 'blueprint'].includes(template.style) ||
    (template.theme && edits.watermarkTheme === 'black');
  const background =
    template.style === 'blueprint'
      ? '#102633'
      : template.style === 'postcard'
        ? '#f5efe3'
        : dark
          ? '#141414'
          : template.style === 'instant'
            ? '#faf8f2'
            : '#ffffff';
  const foreground =
    template.style === 'blueprint'
      ? '#b9e6ed'
      : overlay
        ? edits.watermarkTheme === 'black'
          ? '#151515'
          : '#ffffff'
        : dark
          ? '#f5f5f5'
          : '#171717';
  const secondary =
    template.style === 'blueprint' ? '#85b9c7' : dark || overlay ? '#c6c6c6' : '#777777';
  if (!overlay) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, layout.x, layout.y);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(100, edits.watermarkOpacity)) / 100;
  const camera = edits.watermarkCamera.trim() || metadata.camera || '';
  paintWatermark({
    context,
    layout,
    template,
    edits,
    metadata,
    title: edits.watermarkText.trim() || camera || t('摄影作品'),
    camera,
    details: edits.watermarkShowParameters ? metadata.parameters || '' : '',
    time: edits.watermarkShowTime && template.time ? metadata.capturedAt || '' : '',
    foreground,
    secondary,
    size: Math.max(
      1,
      source.width * 0.028 * Math.max(0.6, Math.min(1.6, edits.watermarkScale / 100)),
    ),
  });
  context.restore();
  return canvas;
}
