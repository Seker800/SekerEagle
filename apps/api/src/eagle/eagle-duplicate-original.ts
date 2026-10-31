import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp, { type OutputInfo } from 'sharp';
import { DUPLICATE_PIXEL_VERSION } from '@sekereagle/library-core';

export interface OriginalProof {
  hash: string | null;
  status: string;
}
let originalLane: Promise<void> = Promise.resolve();
/** Both library modes share one decoder slot in the independent process. */
export async function withDuplicateOriginalSlot<T>(work: () => Promise<T>): Promise<T> {
  const previous = originalLane;
  let release!: () => void;
  originalLane = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}
function budget(value: number | undefined, env: string, fallback: number) {
  const result = value ?? Number(process.env[env] ?? fallback);
  if (!Number.isSafeInteger(result) || result < 1)
    throw new Error('INVALID_DUPLICATE_ORIGINAL_BUDGET');
  return result;
}
/** libvips exposes only the first APNG frame. Inspect chunk headers, without reading IDAT payloads. */
async function hasPngAnimation(path: string, signal?: AbortSignal) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size,
      header = Buffer.alloc(8);
    let offset = 8;
    while (offset + 12 <= size) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(header, 0, 8, offset);
      const length = header.readUInt32BE(0),
        kind = header.toString('ascii', 4, 8);
      if (bytesRead !== 8 || offset + length + 12 > size) throw new Error('INVALID_DUPLICATE_PNG');
      if (['acTL', 'fcTL', 'fdAT'].includes(kind)) return true;
      if (kind === 'IEND') return false;
      offset += length + 12;
    }
    throw new Error('INVALID_DUPLICATE_PNG');
  } finally {
    await file.close();
  }
}
/** Independent executor only. Stream the source and hash decoder output without collecting chunks. */
export async function verifyDuplicateOriginal(
  body: Readable,
  expectedSha256: string,
  options: { maxBytes?: number; maxPixels?: number; signal?: AbortSignal } = {},
): Promise<OriginalProof> {
  let dir: string | undefined;
  try {
    const maxBytes = budget(options.maxBytes, 'EAGLE_DUPLICATE_ORIGINAL_MAX_BYTES', 536_870_912);
    const maxPixels = budget(options.maxPixels, 'EAGLE_DUPLICATE_ORIGINAL_MAX_PIXELS', 65_000_000);
    dir = await mkdtemp(join(tmpdir(), 'eagle-duplicate-'));
    const path = join(dir, 'original');
    const fileHash = createHash('sha256');
    let bytes = 0;
    await pipeline(
      body,
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes) return callback(new Error('DUPLICATE_ORIGINAL_TOO_LARGE'));
          fileHash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(path, { mode: 0o600 }),
      { signal: options.signal },
    );
    if (fileHash.digest('hex') !== expectedSha256)
      throw new Error('DUPLICATE_ORIGINAL_HASH_MISMATCH');
    // Read headers first. Unsupported depth/frames never become an eight-bit approximation proof.
    const metadata = await sharp(path, { limitInputPixels: false, failOn: 'warning' }).metadata();
    if (
      !['jpeg', 'png'].includes(metadata.format ?? '') ||
      metadata.depth !== 'uchar' ||
      (metadata.bitsPerSample ?? 8) > 8 ||
      (metadata.pages ?? 1) !== 1
    )
      return { hash: null, status: 'UNSUPPORTED' };
    if (
      (metadata.format === 'png' && (await hasPngAnimation(path, options.signal))) ||
      metadata.xmp?.includes('MotionPhoto') ||
      metadata.xmp?.includes('MicroVideo')
    )
      return { hash: null, status: 'UNSUPPORTED' };
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels)
      return { hash: null, status: 'PIXEL_LIMIT' };
    const hash = createHash('sha256');
    const decoder = sharp(path, {
      limitInputPixels: maxPixels,
      failOn: 'warning',
      sequentialRead: true,
    })
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw();
    decoder.once('info', (info: OutputInfo) =>
      hash.update(`${DUPLICATE_PIXEL_VERSION}:${info.width}:${info.height}:4:`),
    );
    await pipeline(
      decoder,
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback();
        },
      }),
      { signal: options.signal },
    );
    return { hash: hash.digest('hex'), status: 'VERIFIED' };
  } finally {
    body.destroy();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
