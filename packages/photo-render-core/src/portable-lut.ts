import type { PhotoLut } from './photo-lut';
/** Canonical little-endian Float32 table. No file names, URLs or executable content. */
export function writePortableLut(lut: PhotoLut): string {
  const bytes = new Uint8Array(lut.data.length * 4);
  const view = new DataView(bytes.buffer);
  lut.data.forEach((v, i) => view.setFloat32(i * 4, v, true));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return JSON.stringify({
    size: lut.size,
    domainMin: lut.domainMin,
    domainMax: lut.domainMax,
    data: btoa(binary),
  });
}
export function readPortableLut(input: string): PhotoLut {
  if (input.length > 4500000) throw new Error('INVALID_LUT');
  const row = JSON.parse(input) as {
    size: number;
    domainMin: number[];
    domainMax: number[];
    data: string;
  };
  if (
    !Number.isInteger(row.size) ||
    row.size < 2 ||
    row.size > 65 ||
    !Array.isArray(row.domainMin) ||
    !Array.isArray(row.domainMax) ||
    row.domainMin.length !== 3 ||
    row.domainMax.length !== 3 ||
    row.domainMin.some(
      (v, i) =>
        !Number.isFinite(v) ||
        !Number.isFinite(row.domainMax[i]) ||
        !Number.isFinite(row.domainMax[i] - v) ||
        v >= row.domainMax[i],
    )
  )
    throw new Error('INVALID_LUT');
  const expected = row.size ** 3 * 3;
  if (
    typeof row.data !== 'string' ||
    row.data.length !== 4 * Math.ceil((expected * 4) / 3) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(row.data)
  )
    throw new Error('INVALID_LUT');
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  if (bytes.length !== expected * 4) throw new Error('INVALID_LUT');
  const view = new DataView(bytes.buffer);
  const data = Float32Array.from({ length: expected }, (_, i) => view.getFloat32(i * 4, true));
  if (data.some((v) => !Number.isFinite(v) || Math.abs(v) > 16)) throw new Error('INVALID_LUT');
  return {
    size: row.size,
    data,
    domainMin: row.domainMin as PhotoLut['domainMin'],
    domainMax: row.domainMax as PhotoLut['domainMax'],
  };
}
