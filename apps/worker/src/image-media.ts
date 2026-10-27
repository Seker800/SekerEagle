import { decodeHeifFile, assertSafeHeifInfo as assertHeifPixels } from '@sekereagle/media-core';
import { isCameraRawMime, CAMERA_MAX_IMAGE_PIXELS } from '@sekereagle/library-core';
import { readCameraRaw, type CameraDimensions } from '@sekereagle/media-core';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp, { type Sharp } from 'sharp';
import { classifyImageInputError, PermanentMediaValidationError } from './media-validation-error';

export const MAX_EAGLE_IMAGE_INPUT_PIXELS = CAMERA_MAX_IMAGE_PIXELS;

// Temporary inputs must close before cleanup (Windows cannot unlink cached open files).
// Bound decoded memory separately from queue concurrency.
// Media jobs are already concurrency-controlled at the queue boundary.
sharp.cache({ memory: 64, files: 0, items: 100 });
sharp.concurrency(1);

export function assertSafeHeifInfo(output: string): void {
  try {
    assertHeifPixels(output);
  } catch {
    throw new PermanentMediaValidationError(
      'IMAGE_PIXEL_LIMIT_EXCEEDED',
      'HEIC/HEIF 图片像素数量超出安全限制。',
    );
  }
}

export async function decodeProcessableImage(
  input: Buffer,
  mimeType: string,
  storageKey: string,
): Promise<Buffer> {
  if (!requiresHeifDecode(mimeType, storageKey) && !isCameraRawMime(mimeType)) return input;

  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heif-'));
  const inputPath = join(directory, 'input.heic');
  const outputPath = join(directory, isCameraRawMime(mimeType) ? 'decoded.tiff' : 'decoded.png');
  try {
    await writeFile(inputPath, input, { flag: 'wx' });
    if (isCameraRawMime(mimeType)) await readCameraRaw(inputPath, outputPath);
    else await decodeHeifFile(inputPath, outputPath);
    return await readFile(outputPath);
  } catch (error) {
    throw classifyImageInputError(error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function withProcessableImage<T>(
  source: AsyncIterable<Uint8Array>,
  mimeType: string,
  storageKey: string,
  operation: (
    image: Sharp,
    originalPath?: string,
    originalDimensions?: CameraDimensions,
  ) => Promise<T>,
  retainOriginal = false,
  rawPurpose: 'BROWSE' | 'DEVELOP' = 'DEVELOP',
): Promise<{ result: T; sha256: string; sourceMode: 'IMAGE' | 'RAW_EMBEDDED' | 'RAW_DEVELOPED' }> {
  const hash = createHash('sha256');
  const hashTap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  if (!requiresHeifDecode(mimeType, storageKey) && !isCameraRawMime(mimeType) && !retainOriginal) {
    const image = sharp({ failOn: 'error', limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS });
    const resultPromise = operation(image);
    try {
      const [result] = await Promise.all([
        resultPromise,
        pipeline(Readable.from(source), hashTap, image),
      ]);
      return { result, sha256: hash.digest('hex'), sourceMode: 'IMAGE' };
    } catch (error) {
      throw classifyImageInputError(error);
    }
  }

  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heif-'));
  const inputPath = join(directory, 'input.heic');
  let outputPath = join(directory, isCameraRawMime(mimeType) ? 'decoded.tiff' : 'decoded.png');
  try {
    await pipeline(Readable.from(source), hashTap, createWriteStream(inputPath, { flags: 'wx' }));
    const originalDimensions = isCameraRawMime(mimeType)
      ? await readCameraRaw(inputPath, outputPath, undefined, rawPurpose)
      : undefined;
    if (!originalDimensions) {
      if (requiresHeifDecode(mimeType, storageKey)) await decodeHeifFile(inputPath, outputPath);
      else outputPath = inputPath;
    }
    const result = await operation(
      sharp(outputPath, { failOn: 'error', limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS }),
      inputPath,
      originalDimensions,
    );
    return {
      result,
      sha256: hash.digest('hex'),
      sourceMode: isCameraRawMime(mimeType)
        ? originalDimensions?.embeddedPreview
          ? 'RAW_EMBEDDED'
          : 'RAW_DEVELOPED'
        : 'IMAGE',
    };
  } catch (error) {
    throw classifyImageInputError(error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function requiresHeifDecode(mimeType: string, storageKey: string): boolean {
  return (
    mimeType === 'image/heic' || mimeType === 'image/heif' || /\.(?:heic|heif)$/i.test(storageKey)
  );
}
