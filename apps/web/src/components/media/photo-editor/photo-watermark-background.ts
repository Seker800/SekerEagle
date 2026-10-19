import { DEFAULT_PHOTO_EDITS, type PhotoEdits } from './photo-editor-model';
import { triangleBlur } from './photo-editor-detail';

/** Blur a bounded proxy rather than allocating full-resolution convolution buffers. */
export function paintFrostedWatermarkBackground(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  createCanvas: () => HTMLCanvasElement,
  settings: Pick<PhotoEdits, 'watermarkBlur' | 'watermarkDarkness'> = DEFAULT_PHOTO_EDITS,
) {
  const percent = (value: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
  const blur = percent(settings.watermarkBlur, DEFAULT_PHOTO_EDITS.watermarkBlur);
  const darkness = percent(settings.watermarkDarkness, DEFAULT_PHOTO_EDITS.watermarkDarkness);
  const proxy = createCanvas();
  const scale = Math.min(1, 512 / Math.max(target.width, target.height));
  proxy.width = Math.max(1, Math.round(target.width * scale));
  proxy.height = Math.max(1, Math.round(target.height * scale));
  const context = proxy.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.fillStyle = '#141414';
  context.fillRect(0, 0, proxy.width, proxy.height);
  const cover = Math.max(proxy.width / source.width, proxy.height / source.height);
  const width = source.width * cover,
    height = source.height * cover;
  context.drawImage(source, (proxy.width - width) / 2, (proxy.height - height) / 2, width, height);
  const image = context.getImageData(0, 0, proxy.width, proxy.height);
  const count = proxy.width * proxy.height;
  const radius = Math.round(Math.max(proxy.width, proxy.height) * 0.04 * (blur / 100));
  for (let channel = 0; channel < 3; channel++) {
    const input = new Float32Array(count);
    for (let p = 0; p < count; p++) input[p] = image.data[p * 4 + channel];
    const blurred = radius > 0 ? triangleBlur(input, proxy.width, proxy.height, radius) : input;
    // Tint only the background; photo pixels and typography are composited separately.
    for (let p = 0; p < count; p++)
      image.data[p * 4 + channel] = Math.round(blurred[p] * (1 - darkness / 100));
  }
  context.putImageData(image, 0, 0);
  const output = target.getContext('2d');
  if (!output) throw new Error('CANVAS_UNAVAILABLE');
  output.drawImage(proxy, 0, 0, target.width, target.height);
}
