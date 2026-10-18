import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const run = promisify(execFile);
export async function createCameraFixtures(directory) {
  await mkdir(directory, { recursive: true });
  const files = [
    { name: 'synthetic.dng', mimeType: 'image/x-adobe-dng' },
    { name: 'synthetic.tiff', mimeType: 'image/tiff' },
    {
      name: 'prores.mov',
      mimeType: 'video/quicktime',
      audio: 'pcm_s16le',
      codec: ['-c:v', 'prores_ks', '-profile:v', '0', '-pix_fmt', 'yuv422p10le'],
    },
    {
      name: 'hevc.mp4',
      mimeType: 'video/mp4',
      codec: [
        '-c:v',
        'libx265',
        '-x265-params',
        'log-level=error:pools=1:frame-threads=1',
        '-pix_fmt',
        'yuv420p',
      ],
    },
    {
      name: 'avchd.mts',
      mimeType: 'video/mp2t',
      codec: ['-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p'],
    },
    {
      name: 'mjpeg.avi',
      mimeType: 'video/x-msvideo',
      codec: ['-c:v', 'mjpeg', '-threads', '1', '-pix_fmt', 'yuvj420p'],
    },
    {
      name: 'mpeg2.mxf',
      mimeType: 'application/mxf',
      size: '1920x1080',
      codec: ['-c:v', 'mpeg2video', '-threads', '1', '-pix_fmt', 'yuv422p', '-b:v', '50000000'],
    },
  ];
  await run(
    process.env.CAMERA_RAW_PYTHON || 'python3',
    ['scripts/testing/create-camera-fixtures.py', join(directory, files[0].name)],
    { timeout: 60_000, maxBuffer: 256 * 1024 },
  );
  await sharp({ create: { width: 640, height: 360, channels: 3, background: '#d69b48' } })
    .tiff()
    .toFile(join(directory, files[1].name));
  for (const file of files.filter((file) => file.codec)) {
    await run(
      process.env.FFMPEG_PATH || 'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${file.size || '640x360'}:rate=25`,
        ...(file.audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []),
        '-t',
        '0.6',
        ...file.codec,
        ...(file.audio ? ['-c:a', file.audio] : []),
        join(directory, file.name),
      ],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
  }
  return files.map((file) => ({ ...file, path: join(directory, file.name) }));
}
