import { quantize } from './vendor/quantize';
import { hexColorLab } from './color-search';
export const COLOR_PALETTE_VERSION = 'color-v4-eagle-basic';
export interface RepresentativeColor {
  hex: string;
  weight: number;
  labL: number;
  labA: number;
  labB: number;
}
interface QuantizedPalette {
  cmap: { palette(): Array<{ color: number[]; count: number }> };
  pixelCount: number;
}
/** Eagle's basic MMCQ settings: 12 colors, alpha >=170, 5-bit bins and 0.25% floor. */
export function extractSearchColors(
  pixels: Uint8Array,
  channels: number,
  pixelCount: number,
  limit = 12,
): RepresentativeColor[] {
  if (channels < 3 || pixelCount < 0 || pixelCount * channels > pixels.length)
    throw new Error('颜色提取需要完整 RGB 或 RGBA 像素。');
  const rgba = channels === 4 ? pixels.subarray(0, pixelCount * 4) : new Uint8Array(pixelCount * 4);
  if (channels !== 4)
    for (let i = 0; i < pixelCount; i++) {
      rgba[i * 4] = pixels[i * channels]!;
      rgba[i * 4 + 1] = pixels[i * channels + 1]!;
      rgba[i * 4 + 2] = pixels[i * channels + 2]!;
      rgba[i * 4 + 3] = channels >= 4 ? pixels[i * channels + 3]! : 255;
    }
  if (!rgba.length) return [];
  const skip =
    rgba.length < 1e5
      ? 1
      : rgba.length < 1e6
        ? 10
        : rgba.length < 1e7
          ? 100
          : rgba.length < 1e8
            ? 1000
            : 10000;
  const result = quantize(rgba, rgba.length, skip, 170, 12) as QuantizedPalette | false;
  if (!result) return [];
  return result.cmap
    .palette()
    .map(({ color, count }) => {
      let percent = Math.round((count / result.pixelCount) * 10000) / 100;
      if (percent >= 5) percent = Math.trunc(percent);
      return { color, percent };
    })
    .filter((c) => c.percent >= 0.25)
    .sort((a, b) => b.percent - a.percent)
    .filter((c, index) => index < 6 || c.percent > 0.3)
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map(({ color, percent }) => {
      const hex = '#' + color.map((channel) => channel.toString(16).padStart(2, '0')).join('');
      const [labL, labA, labB] = hexColorLab(hex);
      return { hex, weight: percent / 100, labL, labA, labB };
    });
}
