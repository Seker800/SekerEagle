import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { DUPLICATE_PIXEL_VERSION } from '@sekereagle/library-core';

export interface OriginalProof { hash: string | null; status: string }
function budget(value: number | undefined, env: string, fallback: number) {
  const result = value ?? Number(process.env[env] ?? fallback);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('INVALID_DUPLICATE_ORIGINAL_BUDGET');
  return result;
}
/** Runs only in the independent operations executor. Never buffer original or decoded pixels in JS. */
export async function verifyDuplicateOriginal(
  body: Readable,
  expectedSha256: string,
  options: { maxBytes?: number; maxPixels?: number; signal?: AbortSignal } = {},
): Promise<OriginalProof> {
  const maxBytes = budget(options.maxBytes, 'EAGLE_DUPLICATE_ORIGINAL_MAX_BYTES', 536_870_912);
  const maxPixels = budget(options.maxPixels, 'EAGLE_DUPLICATE_ORIGINAL_MAX_PIXELS', 65_000_000);
  const dir = await mkdtemp(join(tmpdir(), 'eagle-duplicate-'));
  try {
    const path = join(dir, 'original');
    const fileHash = createHash('sha256');
    let bytes = 0;
    await pipeline(body, new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error('DUPLICATE_ORIGINAL_TOO_LARGE'));
      fileHash.update(chunk);
      callback(null, chunk);
    } }), createWriteStream(path, { mode: 0o600 }), { signal: options.signal });
    if (fileHash.digest('hex') !== expectedSha256) throw new Error('DUPLICATE_ORIGINAL_HASH_MISMATCH');
    // Read headers first. Unsupported depth/frames never become an eight-bit approximation proof.
    const metadata = await sharp(path, { limitInputPixels: false, failOn: 'warning' }).metadata();
    if (!['jpeg', 'png'].includes(metadata.format ?? '') || metadata.depth !== 'uchar' || (metadata.pages ?? 1) !== 1)
      return { hash: null, status: 'UNSUPPORTED' };
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels)
      return { hash: null, status: 'PIXEL_LIMIT' };
    const hash = createHash('sha256');
    const decoder = sharp({ limitInputPixels: maxPixels, failOn: 'warning', sequentialRead: true })
      .rotate().toColourspace('srgb').ensureAlpha().raw();
    decoder.once('info', info => hash.update(`${DUPLICATE_PIXEL_VERSION}:${info.width}:${info.height}:4:`));
    await pipeline(createReadStream(path), decoder,
      new Writable({ write(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(); } }),
      { signal: options.signal });
    return { hash: hash.digest('hex'), status: 'VERIFIED' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
