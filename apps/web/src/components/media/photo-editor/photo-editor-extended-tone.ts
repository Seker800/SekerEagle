// GPUImage (BSD-3-Clause): highlight/shadow curves, levels, white-balance overlay/YIQ.
// glfx.js (MIT): additive brightness and vibrance. Adapted to CPU processing.
// See docs/photo-editor.md and the complete notices in third-party/photo-editor/.
import type { PhotoEdits } from './photo-editor-model';

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const signed = (v: number) => clamp(v / 100, -1, 1);
const lift = (y: number) => Math.max(y, Math.sqrt(y) - 0.76 * y);
const compress = (y: number) => Math.min(y, 1 - (Math.sqrt(1 - y) - 0.8 * (1 - y)));

function inverse(fn: (v: number) => number, target: number): number {
  let low = 0,
    high = 1;
  for (let i = 0; i < 25; i++) {
    const mid = (low + high) / 2;
    if (fn(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// Interpolate the reference curves to avoid their low-strength dead zones.
// Signed controls use the inverse reference curve in the opposite direction.
export function adjustedLuminance(y: number, shadows: number, highlights: number): number {
  const s = signed(shadows),
    h = signed(highlights);
  let result = y;
  if (s) result += Math.abs(s) * ((s > 0 ? lift(y) : inverse(lift, y)) - y);
  if (h) result += Math.abs(h) * ((h < 0 ? compress(y) : inverse(compress, y)) - y);
  return clamp(result);
}

export function applyExtendedTone(pixels: Uint8Array, edits: PhotoEdits): Uint8Array {
  if (
    ![
      edits.brightness,
      edits.lightPerception,
      edits.highlights,
      edits.shadows,
      edits.whites,
      edits.blacks,
      edits.vibrance,
      edits.temperature,
      edits.tint,
      edits.fade,
    ].some(Boolean)
  )
    return pixels;
  const output = pixels.slice();
  const brightness = signed(edits.brightness) * 0.18;
  const black = signed(edits.blacks) * 0.12;
  const white = signed(edits.whites) * 0.15;
  const fade = clamp(edits.fade / 100);
  const minimumIn = Math.max(0, -black),
    maximumIn = 1 - Math.max(0, white);
  const minimumOut = Math.max(0, black),
    maximumOut = 1 + Math.min(0, white);
  const levels = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const input = clamp((i / 255 + brightness - minimumIn) / (maximumIn - minimumIn));
    levels[i] = minimumOut + input * (maximumOut - minimumOut);
  }
  const brilliance = signed(edits.lightPerception);
  const shadows = clamp(signed(edits.shadows) + brilliance * 0.45, -1, 1) * 100;
  const highlights = clamp(signed(edits.highlights) - brilliance * 0.3, -1, 1) * 100;
  const curve = new Float64Array(4097);
  const gamma = 2 ** (brilliance * 0.2);
  for (let i = 0; i < curve.length; i++)
    curve[i] = adjustedLuminance(i / 4096, shadows, highlights) ** (1 / gamma);
  const temperature = signed(edits.temperature) * 0.3;
  const tint = signed(edits.tint) * 0.05226;
  const vibrance = signed(edits.vibrance) * 0.65;
  const warm = (v: number, filter: number) => {
    const overlay = v < 0.5 ? 2 * v * filter : 1 - 2 * (1 - v) * (1 - filter);
    return v + (overlay - v) * temperature;
  };
  const encode = (v: number) => Math.round(clamp(fade * 0.16 + v * (1 - fade * 0.22)) * 255);
  for (let i = 0; i < pixels.length; i += 4) {
    let r = levels[pixels[i]],
      g = levels[pixels[i + 1]],
      b = levels[pixels[i + 2]];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (y > 0 && (shadows || highlights || brilliance)) {
      const position = y * 4096,
        index = Math.min(4095, Math.floor(position));
      const target = curve[index] + (curve[index + 1] - curve[index]) * (position - index);
      const scale = target / y;
      r *= scale;
      g *= scale;
      b *= scale;
    }
    if (tint) {
      const q = 0.212 * r - 0.523 * g + 0.311 * b;
      const delta = clamp(q + tint, -0.5226, 0.5226) - q;
      r += 0.621 * delta;
      g -= 0.647 * delta;
      b += 1.702 * delta;
    }
    if (temperature) {
      r = warm(r, 0.93);
      g = warm(g, 0.54);
      b = warm(b, 0);
    }
    const average = (r + g + b) / 3;
    const maximum = Math.max(r, g, b);
    const amount = (maximum - average) * (-vibrance * 3);
    output[i] = encode(r + (maximum - r) * amount);
    output[i + 1] = encode(g + (maximum - g) * amount);
    output[i + 2] = encode(b + (maximum - b) * amount);
  }
  return output;
}
