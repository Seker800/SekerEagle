/** Portable RGB tables; data is red-fastest, then green, then blue. */
export interface PhotoLut {
  size: number;
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}
const invalid = () => new Error('INVALID_LUT');
const triple = (parts: string[]): [number, number, number] => {
  const values = parts.map(Number);
  if (values.length !== 3 || values.some((v) => !Number.isFinite(v))) throw invalid();
  return values as [number, number, number];
};
export function parseCubeLut(text: string): PhotoLut {
  if (text.length > 16 * 1024 * 1024) throw invalid();
  let size = 0,
    data: Float32Array | undefined,
    count = 0;
  let domainMin: PhotoLut['domainMin'] = [0, 0, 0],
    domainMax: PhotoLut['domainMax'] = [1, 1, 1];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const [key, ...values] = line.split(/\s+/);
    if (key === 'TITLE') continue;
    if (key === 'LUT_3D_SIZE') {
      if (size || count || values.length !== 1) throw invalid();
      size = Number(values[0]);
      if (!Number.isInteger(size) || size < 2 || size > 65) throw invalid();
      data = new Float32Array(size ** 3 * 3);
    } else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      if (count) throw invalid();
      if (key === 'DOMAIN_MIN') domainMin = triple(values);
      else domainMax = triple(values);
    } else {
      if (!data || count + 3 > data.length) throw invalid();
      const value = triple([key, ...values]);
      if (value.some((v) => Math.abs(v) > 16)) throw invalid();
      data.set(value, count);
      count += 3;
    }
  }
  if (!data || count !== data.length || domainMax.some((v, i) => v <= domainMin[i]))
    throw invalid();
  return { size, data, domainMin, domainMax };
}
export function pngLutLayout(width: number, height: number) {
  if (width === height && (width === 512 || width === 64)) {
    const size = width === 512 ? 64 : 16;
    return { size, columns: width / size };
  }
  if ([16, 32, 64].includes(height) && width === height * height)
    return { size: height, columns: height };
  throw invalid();
}
export function parsePngLut(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  channels = 4,
): PhotoLut {
  const { size, columns } = pngLutLayout(width, height);
  if (![3, 4].includes(channels) || pixels.length !== width * height * channels) throw invalid();
  const data = new Float32Array(size ** 3 * 3);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const p =
          ((Math.floor(b / columns) * size + g) * width + (b % columns) * size + r) * channels;
        const index = ((b * size + g) * size + r) * 3;
        for (let c = 0; c < 3; c++) data[index + c] = pixels[p + c] / 255;
      }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
/** Trilinear interpolation in the input RGB domain; never changes source alpha. */
export function applyPhotoLut(pixels: Uint8Array, lut: PhotoLut, strength: number): Uint8Array {
  if (strength <= 0) return pixels;
  const amount = Math.min(100, strength) / 100;
  const output = new Uint8Array(pixels);
  const max = lut.size - 1;
  const scales = lut.domainMax.map((v, c) => max / ((v - lut.domainMin[c]) * 255));
  const at = (rr: number, gg: number, bb: number, c: number) =>
    lut.data[((bb * lut.size + gg) * lut.size + rr) * 3 + c];
  for (let p = 0; p < pixels.length; p += 4) {
    const r = Math.max(0, Math.min(max, (pixels[p] - lut.domainMin[0] * 255) * scales[0]));
    const g = Math.max(0, Math.min(max, (pixels[p + 1] - lut.domainMin[1] * 255) * scales[1]));
    const b = Math.max(0, Math.min(max, (pixels[p + 2] - lut.domainMin[2] * 255) * scales[2]));
    const r0 = Math.floor(r),
      g0 = Math.floor(g),
      b0 = Math.floor(b);
    const r1 = Math.min(max, r0 + 1),
      g1 = Math.min(max, g0 + 1),
      b1 = Math.min(max, b0 + 1);
    const rf = r - r0,
      gf = g - g0,
      bf = b - b0;
    for (let c = 0; c < 3; c++) {
      const low =
        (at(r0, g0, b0, c) * (1 - rf) + at(r1, g0, b0, c) * rf) * (1 - gf) +
        (at(r0, g1, b0, c) * (1 - rf) + at(r1, g1, b0, c) * rf) * gf;
      const high =
        (at(r0, g0, b1, c) * (1 - rf) + at(r1, g0, b1, c) * rf) * (1 - gf) +
        (at(r0, g1, b1, c) * (1 - rf) + at(r1, g1, b1, c) * rf) * gf;
      const mapped = Math.max(0, Math.min(255, (low * (1 - bf) + high * bf) * 255));
      output[p + c] = Math.round(pixels[p + c] * (1 - amount) + mapped * amount + 1e-9);
    }
  }
  return output;
}
