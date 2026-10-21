import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CAMERA_MAX_IMAGE_PIXELS } from '@sekereagle/library-core';
import { mediaSubprocessEnvironment } from './subprocess-environment';
const run = promisify(execFile);

export function assertSafeHeifInfo(output: string): void {
  const images = [...output.matchAll(/^\s*image:\s+(\d+)x(\d+)\b/gm)];
  const pixels = images.reduce((sum, image) => sum + BigInt(image[1]!) * BigInt(image[2]!), 0n);
  if (
    !images.length ||
    images.some((image) => BigInt(image[1]!) <= 0n || BigInt(image[2]!) <= 0n) ||
    pixels > BigInt(CAMERA_MAX_IMAGE_PIXELS)
  )
    throw new Error('HEIF pixel limit exceeded');
}

/** Same native decoder and aggregate pixel guard at upload and preview generation. */
export async function decodeHeifFile(inputPath: string, outputPath: string): Promise<void> {
  const { stdout } = await run(process.env.HEIF_INFO_PATH?.trim() || 'heif-info', [inputPath], {
    env: mediaSubprocessEnvironment(),
    maxBuffer: 256 * 1024,
    timeout: 30_000,
  });
  if (!/^MIME type:\s*image\/hei[cf]\s*$/m.test(stdout))
    throw new Error('HEIF content format mismatch');
  assertSafeHeifInfo(stdout);
  await run(process.env.HEIF_CONVERT_PATH?.trim() || 'heif-dec', [inputPath, outputPath], {
    env: mediaSubprocessEnvironment(),
    timeout: 120_000,
    maxBuffer: 256 * 1024,
  });
}
