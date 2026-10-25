import type { PhotoEdits } from './photo-editor-model';
import { triangleBlur } from './photo-editor-detail';
const clamp = (v: number, low = 0, high = 1) => Math.max(low, Math.min(high, v));

/** Dark-channel prior on a bounded proxy, with a smoothed transmission map. Not RAW recovery. */
export function applyPhotoDehaze(
  input: Uint8Array,
  width: number,
  height: number,
  edits: PhotoEdits,
): Uint8Array {
  const amount = clamp(edits.dehaze / 100, -1, 1);
  if (!amount) return input;
  const scale = Math.min(1, 256 / Math.max(width, height)),
    gw = Math.max(1, Math.round(width * scale)),
    gh = Math.max(1, Math.round(height * scale));
  const samples = new Float32Array(gw * gh * 3),
    valid = new Uint8Array(gw * gh),
    dark = new Float32Array(gw * gh);
  let min = 1,
    max = 0;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i =
          (Math.min(height - 1, Math.floor((y + 0.5) / scale)) * width +
            Math.min(width - 1, Math.floor((x + 0.5) / scale))) *
          4,
        p = y * gw + x;
      if (!input[i + 3]) continue;
      valid[p] = 1;
      for (let c = 0; c < 3; c++) samples[p * 3 + c] = input[i + c] / 255;
      const d = Math.min(samples[p * 3], samples[p * 3 + 1], samples[p * 3 + 2]);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  if (max - min < 1 / 255) return input;
  const radius = Math.max(1, Math.round(Math.max(gw, gh) * 0.015));
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let value = 1;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || !valid[ny * gw + nx]) continue;
          const j = (ny * gw + nx) * 3;
          value = Math.min(value, samples[j], samples[j + 1], samples[j + 2]);
        }
      dark[y * gw + x] = value;
    }
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let p = 0; p < valid.length; p++)
    if (valid[p]) {
      histogram[Math.round(dark[p] * 255)]++;
      count++;
    }
  let threshold = 255,
    remaining = Math.max(1, Math.ceil(count * 0.001));
  while (threshold > 0 && remaining > histogram[threshold]) remaining -= histogram[threshold--];
  let brightest = -1,
    atmosphere = [1, 1, 1];
  for (let p = 0; p < valid.length; p++)
    if (valid[p] && Math.round(dark[p] * 255) >= threshold) {
      const rgb = Array.from(samples.subarray(p * 3, p * 3 + 3)),
        brightness = rgb[0] + rgb[1] + rgb[2];
      if (brightness > brightest) {
        brightest = brightness;
        atmosphere = rgb.map((v) => Math.max(0.25, v));
      }
    }
  const air = Math.max(...atmosphere);
  // Scalar atmospheric normalization avoids changing the scene's white balance.
  for (let p = 0; p < dark.length; p++) dark[p] = clamp(1 - (0.9 * dark[p]) / air, 0.15, 1);
  const transmission = triangleBlur(dark, gw, gh, 1),
    output = input.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!input[i + 3]) continue;
      const gx = clamp(((x + 0.5) * gw) / width - 0.5, 0, gw - 1),
        gy = clamp(((y + 0.5) * gh) / height - 0.5, 0, gh - 1);
      const x0 = Math.floor(gx),
        y0 = Math.floor(gy),
        x1 = Math.min(gw - 1, x0 + 1),
        y1 = Math.min(gh - 1, y0 + 1),
        fx = gx - x0,
        fy = gy - y0;
      const t =
        (transmission[y0 * gw + x0] * (1 - fx) + transmission[y0 * gw + x1] * fx) * (1 - fy) +
        (transmission[y1 * gw + x0] * (1 - fx) + transmission[y1 * gw + x1] * fx) * fy;
      for (let c = 0; c < 3; c++) {
        const value = input[i + c] / 255;
        const result =
          amount > 0
            ? value + ((value - atmosphere[c]) / t + atmosphere[c] - value) * amount * 0.8
            : value + (atmosphere[c] - value) * -amount * 0.45;
        output[i + c] = Math.round(clamp(result) * 255);
      }
    }
  return output;
}
