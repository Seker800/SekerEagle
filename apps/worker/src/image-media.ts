import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const MAX_EAGLE_IMAGE_INPUT_PIXELS = 50_000_000;
const execFileAsync = promisify(execFile);

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
    throw new Error('IMAGE_PIXEL_LIMIT_EXCEEDED');
  }
}

export async function decodeProcessableImage(
  input: Buffer,
  mimeType: string,
  storageKey: string,
): Promise<Buffer> {
  const requiresHeifDecode =
    mimeType === 'image/heic' ||
    mimeType === 'image/heif' ||
    /\.(?:heic|heif)$/i.test(storageKey);
  if (!requiresHeifDecode) return input;

  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heif-'));
  const inputPath = join(directory, 'input.heic');
  const outputPath = join(directory, 'decoded.png');
  try {
    await writeFile(inputPath, input, { flag: 'wx' });
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
    return await readFile(outputPath);
  } catch (error) {
    if (error instanceof Error && error.message === 'IMAGE_PIXEL_LIMIT_EXCEEDED') throw error;
    throw new Error('IMAGE_DECODE_FAILED', { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
