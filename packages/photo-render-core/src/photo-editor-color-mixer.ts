import type { PhotoEdits } from './photo-editor-model';
import {
  CURVE_CHANNELS,
  CURVE_POINTS,
  HSL_BANDS,
  HSL_CENTERS,
  GRADE_ZONES,
  curveKey,
  hslKey,
  gradeKey,
  type CurveChannel,
} from './photo-editor-advanced-model';
const clamp = (v: number, low = 0, high = 1) => Math.max(low, Math.min(high, v));
const wrap = (h: number) => ((h % 360) + 360) % 360;

/** Standard sRGB HSL conversion, CSS Color 4. Hue is in degrees. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [wrap(h * 60), d / (1 - Math.abs(2 * l - 1)), l];
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + wrap(h) / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Fixed x nodes with bounded piecewise-linear interpolation: no overshoot or hidden nodes. */
export function photoCurveLut(edits: PhotoEdits, channel: CurveChannel): Uint8Array {
  const points = CURVE_POINTS.map((point) =>
    clamp(point / 4 + edits[curveKey(channel, point)] / 100),
  );
  return Uint8Array.from({ length: 256 }, (_, i) => {
    const x = (i / 255) * 4,
      segment = Math.min(3, Math.floor(x)),
      fraction = x - segment;
    return Math.round((points[segment] * (1 - fraction) + points[segment + 1] * fraction) * 255);
  });
}

export function applyPhotoColorMixer(input: Uint8Array, edits: PhotoEdits): Uint8Array {
  const bands = HSL_BANDS.map((band, index) => ({
    center: HSL_CENTERS[index],
    hue: clamp(edits[hslKey(band, 'Hue')], -100, 100) * 0.3,
    saturation: clamp(edits[hslKey(band, 'Saturation')], -100, 100) / 100,
    luminance: clamp(edits[hslKey(band, 'Luminance')], -100, 100) / 100,
  }));
  const hslActive = bands.some((b) => b.hue || b.saturation || b.luminance);
  const curvesActive = CURVE_CHANNELS.some((channel) =>
    CURVE_POINTS.some((p) => edits[curveKey(channel, p)]),
  );
  const zones = GRADE_ZONES.map((zone) => {
    const rgb = hslToRgb(edits[gradeKey(zone, 'Hue')], 1, 0.5);
    const y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    return {
      chroma: rgb.map((c) => c - y),
      saturation: clamp(edits[gradeKey(zone, 'Saturation')] / 100),
      luminance: clamp(edits[gradeKey(zone, 'Luminance')] / 100, -1, 1),
    };
  });
  const gradingActive = zones.some((z) => z.saturation || z.luminance);
  if (!hslActive && !curvesActive && !gradingActive) return input;
  const luts = curvesActive ? CURVE_CHANNELS.map((channel) => photoCurveLut(edits, channel)) : [];
  const output = input.slice();
  for (let i = 0; i < input.length; i += 4) {
    if (!input[i + 3]) continue;
    let r = input[i] / 255,
      g = input[i + 1] / 255,
      b = input[i + 2] / 255;
    if (hslActive) {
      const [h, s, l] = rgbToHsl(r, g, b);
      if (s > 1e-6) {
        // Interpolate adjacent bands on the original hue circle; masks never shift during mixing.
        let right = bands.findIndex((band) => band.center > h);
        if (right < 0) right = 0;
        const left = (right + bands.length - 1) % bands.length;
        const end = bands[right].center + (right === 0 ? 360 : 0),
          start = bands[left].center;
        let t = clamp((h - start) / (end - start));
        t = t * t * (3 - 2 * t);
        const mix = (key: 'hue' | 'saturation' | 'luminance') =>
          bands[left][key] * (1 - t) + bands[right][key] * t;
        const dl = mix('luminance');
        [r, g, b] = hslToRgb(
          h + mix('hue'),
          clamp(s * (1 + mix('saturation'))),
          dl > 0 ? l + (1 - l) * dl : l * (1 + dl),
        );
      }
    }
    if (curvesActive) {
      r = luts[1][luts[0][Math.round(r * 255)]] / 255;
      g = luts[2][luts[0][Math.round(g * 255)]] / 255;
      b = luts[3][luts[0][Math.round(b * 255)]] / 255;
    }
    if (gradingActive) {
      const y = r * 0.2126 + g * 0.7152 + b * 0.0722,
        position = clamp(y + clamp(edits.gradeBalance / 100, -1, 1) * 0.35);
      const weights = [(1 - position) ** 2, 4 * position * (1 - position), position ** 2];
      const sum = weights.reduce((a, b) => a + b, 0),
        gate = 4 * y * (1 - y);
      const rgb = [r, g, b];
      zones.forEach((zone, index) => {
        const weight = weights[index] / sum;
        for (let c = 0; c < 3; c++)
          rgb[c] +=
            weight * (zone.chroma[c] * zone.saturation * gate * 0.45 + zone.luminance * 0.25);
      });
      [r, g, b] = rgb;
    }
    output[i] = Math.round(clamp(r) * 255);
    output[i + 1] = Math.round(clamp(g) * 255);
    output[i + 2] = Math.round(clamp(b) * 255);
  }
  return output;
}
