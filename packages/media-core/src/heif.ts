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

/** Header inspection is shared with decoding; upload never expands the image into RGB. */
export async function probeHeifFile(inputPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run(process.env.HEIF_INFO_PATH?.trim() || 'heif-info', [inputPath], {
    env: mediaSubprocessEnvironment(),
    maxBuffer: 256 * 1024,
    timeout: 30_000,
  });
  if (!/^MIME type:\s*image\/hei[cf]\s*$/m.test(stdout))
    throw new Error('HEIF content format mismatch');
  assertSafeHeifInfo(stdout);
  const images = [...stdout.matchAll(/^\s*image:\s+(\d+)x(\d+)([^\n]*)/gm)];
  const primary =
    images.find((image) => /\bprimary\b/.test(image[3]!)) ??
    (images.length === 1 ? images[0] : undefined);
  if (!primary) throw new Error('HEIF primary image missing');
  return { width: Number(primary[1]), height: Number(primary[2]) };
}

/** Same native decoder and aggregate pixel guard at preview generation. */
export async function decodeHeifFile(inputPath: string, outputPath: string): Promise<void> {
  await probeHeifFile(inputPath);
  await run(process.env.HEIF_CONVERT_PATH?.trim() || 'heif-dec', [inputPath, outputPath], {
    env: mediaSubprocessEnvironment(),
    timeout: 120_000,
    maxBuffer: 256 * 1024,
  });
}
