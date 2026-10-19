// CPU adaptations of glfx.js unsharpMask/triangleBlur, monochrome noise and vignette.
// MIT, Copyright (C) 2011 Evan Wallace. Full notice: third-party/photo-editor/glfx-LICENSE.txt.
import { photoCrop, type PhotoEdits } from './photo-editor-model';

const clamp = (v: number, low = 0, high = 1) => Math.max(low, Math.min(high, v));

/** Running-sum separable box convolution, with edge replication. */
function boxPass(
  input: Float32Array,
  output: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
) {
  const length = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const stride = horizontal ? 1 : width;
  const kernel = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * width : line;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++)
      sum += input[start + clamp(offset, 0, length - 1) * stride];
    for (let p = 0; p < length; p++) {
      output[start + p * stride] = sum / kernel;
      sum +=
        input[start + Math.min(length - 1, p + radius + 1) * stride] -
        input[start + Math.max(0, p - radius) * stride];
    }
  }
}

/** Two box convolutions are a discrete triangular (pyramid) kernel. */
export function triangleBlur(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const output = input.slice(),
    scratch = new Float32Array(input.length);
  for (let pass = 0; pass < 2; pass++) {
    boxPass(output, scratch, width, height, radius, true);
    boxPass(scratch, output, width, height, radius, false);
  }
  return output;
}

function unsharp(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,
  amount: number,
) {
  const count = width * height;
  const luminance = new Float32Array(count);
  let hasTransparency = false;
  for (let p = 0; p < count; p++) {
    const i = p * 4,
      alpha = pixels[i + 3] / 255;
    luminance[p] = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) * alpha;
    hasTransparency ||= alpha < 1;
  }
  const blurred = triangleBlur(luminance, width, height, radius);
  let blurredAlpha: Float32Array | undefined;
  if (hasTransparency) {
    const alpha = new Float32Array(count);
    for (let p = 0; p < count; p++) alpha[p] = pixels[p * 4 + 3] / 255;
    blurredAlpha = triangleBlur(alpha, width, height, radius);
  }
  for (let p = 0; p < count; p++) {
    const i = p * 4,
      alpha = pixels[i + 3] / 255;
    if (!alpha) continue;
    const mean = blurredAlpha ? blurred[p] / Math.max(1e-8, blurredAlpha[p]) : blurred[p];
    const difference = (luminance[p] / alpha - mean) * amount;
    for (let channel = 0; channel < 3; channel++)
      pixels[i + channel] = Math.round(clamp(pixels[i + channel] + difference, 0, 255));
  }
}

export function applyPhotoDetail(
  input: Uint8Array,
  width: number,
  height: number,
  edits: PhotoEdits,
): Uint8Array {
  if (![edits.sharpen, edits.clarity, edits.grain, edits.vignette].some(Boolean)) return input;
  const pixels = input.slice();
  const edge = Math.max(width, height);
  // Radii are relative to the photo, rather than hard-coded preview pixels.
  if (edits.sharpen)
    unsharp(
      pixels,
      width,
      height,
      Math.max(1, Math.round(edge * 0.0006)),
      clamp(edits.sharpen / 100, -1, 1) * 0.8,
    );
  if (edits.clarity)
    unsharp(
      pixels,
      width,
      height,
      Math.max(2, Math.round(edge * 0.008)),
      clamp(edits.clarity / 100, -1, 1) * 0.55,
    );
  const grain = clamp(edits.grain / 100) * 0.12;
  const vignette = clamp(edits.vignette / 100, -1, 1);
  if (!grain && !vignette) return pixels;
  const region = photoCrop(width, height, edits);
  const gridWidth = Math.max(
    2,
    Math.round((1280 * region.width) / Math.max(region.width, region.height)),
  );
  const gridHeight = Math.max(
    2,
    Math.round((1280 * region.height) / Math.max(region.width, region.height)),
  );
  const noise = grain ? new Float32Array(gridWidth * gridHeight) : null;
  if (noise) {
    for (let y = 0; y < gridHeight; y++)
      for (let x = 0; x < gridWidth; x++) {
        const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        noise[y * gridWidth + x] = value - Math.floor(value) - 0.5;
      }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!pixels[i + 3]) continue;
      let ox = x + 0.5,
        oy = y + 0.5;
      if (edits.rotation === 90) {
        ox = height - y - 0.5;
        oy = x + 0.5;
      } else if (edits.rotation === 180) {
        ox = width - x - 0.5;
        oy = height - y - 0.5;
      } else if (edits.rotation === 270) {
        ox = y + 0.5;
        oy = width - x - 0.5;
      }
      if (edits.flip) ox = region.orientedWidth - ox;
      const u = (ox - region.x) / region.width,
        v = (oy - region.y) / region.height;
      let difference = 0;
      if (noise) {
        const nx = clamp(u * gridWidth - 0.5, 0, gridWidth - 1);
        const ny = clamp(v * gridHeight - 0.5, 0, gridHeight - 1);
        const x0 = Math.floor(nx),
          y0 = Math.floor(ny);
        const x1 = Math.min(gridWidth - 1, x0 + 1),
          y1 = Math.min(gridHeight - 1, y0 + 1);
        const a =
          noise[y0 * gridWidth + x0] * (1 - nx + x0) + noise[y0 * gridWidth + x1] * (nx - x0);
        const b =
          noise[y1 * gridWidth + x0] * (1 - nx + x0) + noise[y1 * gridWidth + x1] * (nx - x0);
        difference = (a * (1 - ny + y0) + b * (ny - y0)) * grain;
      }
      const distance = Math.hypot(u - 0.5, v - 0.5);
      const t = clamp((distance * (0.5 + Math.abs(vignette) * 0.35) - 0.8) / (0.3995 - 0.8));
      const falloff = t * t * (3 - 2 * t);
      for (let channel = 0; channel < 3; channel++) {
        let value = pixels[i + channel] / 255 + difference;
        if (vignette > 0) value *= falloff;
        else if (vignette < 0) value += (1 - falloff) * (1 - value);
        pixels[i + channel] = Math.round(clamp(value) * 255);
      }
    }
  return pixels;
}
