import sharp from 'sharp';
import type { DuplicateFingerprint } from '@sekereagle/library-core';
export const DUPLICATE_FINGERPRINT_VERSION = 'preview-dhash-rgb-v1';
/** Current thumbnail only: never decode an unbounded original in the operation executor. */
export async function fingerprintPreview(bytes: Buffer): Promise<DuplicateFingerprint> {
  const image = sharp(bytes, {limitInputPixels: 4_000_000, failOn: 'warning'}).rotate().flatten({background: '#ffffff'}).toColourspace('srgb');
  const [gray, colors] = await Promise.all([
    image.clone().resize(9, 8, {fit: 'fill'}).greyscale().raw().toBuffer(),
    image.clone().resize(4, 4, {fit: 'fill'}).removeAlpha().raw().toBuffer(),
  ]);
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | BigInt(gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? 1 : 0);
  const mean = gray.reduce((n, v) => n + v, 0) / gray.length;
  const contrast = Math.sqrt(gray.reduce((n, v) => n + (v - mean) ** 2, 0) / gray.length);
  return {hash: bits.toString(16).padStart(16, '0'), colors: [...colors], contrast};
}
