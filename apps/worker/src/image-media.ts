import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import sharp, { type Sharp } from 'sharp';
import { classifyImageInputError, PermanentMediaValidationError } from './media-validation-error';

export const MAX_EAGLE_IMAGE_INPUT_PIXELS = 50_000_000;
const execFileAsync = promisify(execFile);

// libvips otherwise retains a large process-global cache and may create one worker per CPU.
// Media jobs are already concurrency-controlled at the queue boundary.
sharp.cache({ memory: 64, files: 20, items: 100 });
sharp.concurrency(1);

export function assertSafeHeifInfo(output: string): void {
  const dimensions = [...output.matchAll(/^\s*image:\s+(\d+)x(\d+)\b/gm)];
  const totalPixels = dimensions.reduce(
    (sum, match) => sum + BigInt(match[1]!) * BigInt(match[2]!),
    0n,
  );
  if (
    dimensions.length === 0 ||
    totalPixels <= 0n ||
    totalPixels > BigInt(MAX_EAGLE_IMAGE_INPUT_PIXELS)
  ) {
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
  if (!requiresHeifDecode(mimeType, storageKey)) return input;

  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heif-'));
  const inputPath = join(directory, 'input.heic');
  const outputPath = join(directory, 'decoded.png');
  try {
    await writeFile(inputPath, input, { flag: 'wx' });
    await decodeHeifFile(inputPath, outputPath);
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
  operation: (image: Sharp) => Promise<T>,
): Promise<{ result: T; sha256: string }> {
  const hash = createHash('sha256');
  const hashTap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  if (!requiresHeifDecode(mimeType, storageKey)) {
    const image = sharp({ failOn: 'error', limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS });
    const resultPromise = operation(image);
    try {
      const [result] = await Promise.all([
        resultPromise,
        pipeline(Readable.from(source), hashTap, image),
      ]);
      return { result, sha256: hash.digest('hex') };
    } catch (error) {
      throw classifyImageInputError(error);
    }
  }

  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heif-'));
  const inputPath = join(directory, 'input.heic');
  const outputPath = join(directory, 'decoded.png');
  try {
    await pipeline(Readable.from(source), hashTap, createWriteStream(inputPath, { flags: 'wx' }));
    await decodeHeifFile(inputPath, outputPath);
    const result = await operation(
      sharp(outputPath, { failOn: 'error', limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS }),
    );
    return { result, sha256: hash.digest('hex') };
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

async function decodeHeifFile(inputPath: string, outputPath: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      process.env.HEIF_INFO_PATH?.trim() || 'heif-info',
      [inputPath],
      { maxBuffer: 256 * 1024, timeout: 30_000 },
    );
    assertSafeHeifInfo(stdout);
    await execFileAsync(
      process.env.HEIF_CONVERT_PATH?.trim() || 'heif-convert',
      [inputPath, outputPath],
      { timeout: 120_000 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await rm(outputPath, { force: true });
    await execFileAsync(
      process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
      ['-v', 'error', '-y', '-i', inputPath, '-frames:v', '1', outputPath],
      { timeout: 120_000 },
    );
  }
}
