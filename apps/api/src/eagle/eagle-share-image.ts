import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { isCameraRawMime } from '@sekereagle/library-core';
import { decodeHeifFile, readCameraRaw } from '@sekereagle/media-core';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';

const DEFAULT_SHARE_MAX_EDGE = 4_096;
const DEFAULT_SHARE_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_SHARE_MIN_QUALITY = 60;
const QUALITY_STEPS = [90, 85, 80, 75, 70, 65, 60];
const MAX_DOWNSCALE_ROUNDS = 4;
const DOWNSCALE_FACTOR = 0.85;

export interface RenderedShareImage {
  buffer: Buffer;
  width: number;
  height: number;
  byteSize: number;
}

export interface ShareImageBudget {
  maxEdge: number;
  maxBytes: number;
  minQuality: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('INVALID_SHARE_IMAGE_BUDGET');
  return parsed;
}

export function shareImageBudget(): ShareImageBudget {
  const maxEdge = positiveInteger(process.env.EAGLE_SHARE_IMAGE_MAX_EDGE, DEFAULT_SHARE_MAX_EDGE);
  const maxBytes = positiveInteger(
    process.env.EAGLE_SHARE_IMAGE_MAX_BYTES,
    DEFAULT_SHARE_MAX_BYTES,
  );
  const minQuality = positiveInteger(
    process.env.EAGLE_SHARE_IMAGE_MIN_QUALITY,
    DEFAULT_SHARE_MIN_QUALITY,
  );
  if (minQuality > QUALITY_STEPS[0]!) throw new Error('INVALID_SHARE_IMAGE_BUDGET');
  return { maxEdge, maxBytes, minQuality };
}

let shareRenderLane: Promise<void> = Promise.resolve();
/** Every share render decodes a camera-sized original; keep one decode in flight per API process. */
export function withShareRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  const previous = shareRenderLane;
  let release!: () => void;
  shareRenderLane = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(work).finally(release);
}

export function requiresHeifDecode(mimeType: string, key: string): boolean {
  return mimeType === 'image/heic' || mimeType === 'image/heif' || /\.(?:heic|heif)$/i.test(key);
}

export async function decodeShareSource(
  mimeType: string,
  inputPath: string,
  directory: string,
): Promise<string> {
  if (requiresHeifDecode(mimeType, inputPath)) {
    const decoded = join(directory, 'decoded.png');
    await decodeHeifFile(inputPath, decoded);
    return decoded;
  }
  if (isCameraRawMime(mimeType)) {
    const decoded = join(directory, 'decoded.tiff');
    await readCameraRaw(inputPath, decoded, undefined, 'DEVELOP');
    return decoded;
  }
  return inputPath;
}

async function readOriginalToTemp(
  body: AsyncIterable<Uint8Array>,
  directory: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const inputPath = join(directory, 'original');
  await pipeline(body as Readable, createWriteStream(inputPath, { mode: 0o600 }), {
    signal: abortSignal,
  });
  return inputPath;
}

export interface ShareImageSource {
  mimeType: string;
  openBody(): Promise<AsyncIterable<Uint8Array>>;
}

/** Temporary originals and decoded camera files stay off the request heap. */
export async function renderShareImage(
  source: ShareImageSource,
  budget: ShareImageBudget,
  abortSignal?: AbortSignal,
): Promise<RenderedShareImage> {
  return withShareRenderSlot(async () => {
    abortSignal?.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'sekereagle-share-'));
    try {
      const body = await source.openBody();
      const inputPath = await readOriginalToTemp(body, directory, abortSignal);
      const decodedPath = await decodeShareSource(source.mimeType, inputPath, directory);
      return await renderShareJpeg(decodedPath, budget, abortSignal);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

export interface ShareRawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

function shareChannels(value: number): 1 | 2 | 3 | 4 {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new Error('INVALID_SHARE_IMAGE_CHANNELS');
}

export async function loadShareRawImage(
  sourcePath: string,
  maxEdge: number,
  abortSignal?: AbortSignal,
): Promise<ShareRawImage> {
  abortSignal?.throwIfAborted();
  const metadata = await sharp(sourcePath, {
    limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS,
    failOn: 'warning',
  }).metadata();
  let image = sharp(sourcePath, {
    limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS,
    failOn: 'warning',
    sequentialRead: true,
  })
    .rotate()
    .toColourspace('srgb');
  if (metadata.hasAlpha) image = image.flatten({ background: '#ffffff' });
  const { data, info } = await image
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  abortSignal?.throwIfAborted();
  return { data, width: info.width, height: info.height, channels: shareChannels(info.channels) };
}

export async function renderShareJpeg(
  sourcePath: string,
  budget: ShareImageBudget,
  abortSignal?: AbortSignal,
): Promise<RenderedShareImage> {
  let raw = await loadShareRawImage(sourcePath, budget.maxEdge, abortSignal);
  let fallback: RenderedShareImage | null = null;
  for (let round = 0; round <= MAX_DOWNSCALE_ROUNDS; round++) {
    for (const quality of QUALITY_STEPS) {
      if (quality < budget.minQuality) break;
      abortSignal?.throwIfAborted();
      const buffer = await sharp(raw.data, {
        raw: { width: raw.width, height: raw.height, channels: raw.channels },
      })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const rendered = { buffer, width: raw.width, height: raw.height, byteSize: buffer.length };
      fallback = rendered;
      if (buffer.length <= budget.maxBytes) return rendered;
    }
    if (round === MAX_DOWNSCALE_ROUNDS) break;
    const nextEdge = Math.max(
      1_024,
      Math.floor(Math.max(raw.width, raw.height) * DOWNSCALE_FACTOR),
    );
    raw = await downscaleRaw(raw, nextEdge);
  }
  // The byte ceiling is a safety net; if it cannot be met, return the smallest real rendition.
  return fallback!;
}

async function downscaleRaw(raw: ShareRawImage, maxEdge: number): Promise<ShareRawImage> {
  const { data, info } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: raw.channels },
  })
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: shareChannels(info.channels) };
}
