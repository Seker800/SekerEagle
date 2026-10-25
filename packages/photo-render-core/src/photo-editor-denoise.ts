import type { PhotoEdits } from './photo-editor-model';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Small bilateral neighborhood: separate luma/chroma mixing, alpha-weighted visible neighbors. */
export function applyPhotoDenoise(
  input: Uint8Array,
  width: number,
  height: number,
  edits: PhotoEdits,
): Uint8Array {
  const luma = clamp(edits.luminanceNoise / 100) * 0.85,
    chroma = clamp(edits.colorNoise / 100);
  if (!luma && !chroma) return input;
  const output = input.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!input[i + 3]) continue;
      const sourceY = luminance(input[i], input[i + 1], input[i + 2]);
      let total = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (!input[j + 3]) continue;
          const distanceY = luminance(input[j], input[j + 1], input[j + 2]) - sourceY;
          const colorDistance =
            (input[j] - input[i]) ** 2 +
            (input[j + 1] - input[i + 1]) ** 2 +
            (input[j + 2] - input[i + 2]) ** 2;
          const weight =
            (Math.exp(-(distanceY ** 2) / 1250 - colorDistance / 25350 - (dx * dx + dy * dy) / 4) *
              input[j + 3]) /
            255;
          total += weight;
          r += input[j] * weight;
          g += input[j + 1] * weight;
          b += input[j + 2] * weight;
        }
      const mean = [r / total, g / total, b / total],
        meanY = luminance(...(mean as [number, number, number]));
      const resultY = sourceY + (meanY - sourceY) * luma;
      for (let c = 0; c < 3; c++)
        output[i + c] = Math.round(
          Math.max(
            0,
            Math.min(
              255,
              resultY + (input[i + c] - sourceY) * (1 - chroma) + (mean[c] - meanY) * chroma,
            ),
          ),
        );
    }
  return output;
}
