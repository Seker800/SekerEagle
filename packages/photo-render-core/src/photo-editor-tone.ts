import type { PhotoEdits } from './photo-editor-model';

// Documented formulas, not Adobe's proprietary rendering engine.
// Exposure: EV light multiplier + W3C CSS Color 4 sRGB transfer functions.
// Contrast: ImageMagick's normalized sigmoid / inverse sigmoid (midpoint 50%).
// Saturation: W3C Filter Effects 1 saturation matrix, in sRGB.
// Sources and application-specific strength calibration: docs/photo-editor.md.
export const MAX_SIGMOID_STRENGTH = 6;
export const MIDTONE_GAMMA_STOPS = 0.5;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}
export function photoContrast(value: number, amount: number): number {
  const strength = (Math.abs(clamp(amount, -100, 100)) / 100) * MAX_SIGMOID_STRENGTH;
  if (strength < 1e-8 || value === 0 || value === 1) return value;
  const low = 1 / (1 + Math.exp(strength / 2));
  const high = 1 - low;
  if (amount > 0) return (1 / (1 + Math.exp(strength * (0.5 - value))) - low) / (high - low);
  const probability = low + value * (high - low);
  return 0.5 - Math.log(1 / probability - 1) / strength;
}
export function applyPhotoTone(pixels: Uint8Array, edits: PhotoEdits): Uint8Array {
  const output = pixels.slice();
  const exposure = clamp(edits.exposure, -5, 5);
  const gain = 2 ** exposure;
  // Floating-point lookup values avoid quantizing the curve before saturation.
  const lookup = new Float64Array(256);
  for (let i = 0; i < lookup.length; i++) {
    const exposed =
      exposure === 0 ? i / 255 : clamp(linearToSrgb(srgbToLinear(i / 255) * gain), 0, 1);
    lookup[i] = photoContrast(exposed, edits.contrast) * 255;
  }
  const saturation = 1 + clamp(edits.saturation, -100, 100) / 100;
  for (let i = 0; i < output.length; i += 4) {
    const r = lookup[pixels[i]],
      g = lookup[pixels[i + 1]],
      b = lookup[pixels[i + 2]];
    const luminance = 0.213 * r + 0.715 * g + 0.072 * b;
    output[i] = Math.round(clamp(luminance + saturation * (r - luminance), 0, 255));
    output[i + 1] = Math.round(clamp(luminance + saturation * (g - luminance), 0, 255));
    output[i + 2] = Math.round(clamp(luminance + saturation * (b - luminance), 0, 255));
  }
  return output;
}
