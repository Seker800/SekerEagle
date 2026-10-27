import {
  cameraVideoEncodingArguments,
  assertCameraRawRuntime,
  mediaSubprocessEnvironment,
  type CameraVideoEncoder,
} from '@sekereagle/media-core';
import { readComputeToken, nodeOperations } from './compute-node-config';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { inferPhotoFaces } from './face-inference';
import { createRemoteMediaServer } from './remote-media';
async function main() {
  const configuredFaces = Boolean(
    process.env.PHOTO_FACE_PYTHON || process.env.PHOTO_FACE_MODEL_DIR,
  );
  const videoEncoder = process.env.EAGLE_COMPUTE_VIDEO_ENCODER as CameraVideoEncoder | undefined;
  const operations = nodeOperations(
    process.env.EAGLE_COMPUTE_NODE_OPERATIONS ??
      ['image', ...(configuredFaces ? ['faces'] : []), ...(videoEncoder ? ['video'] : [])].join(
        ',',
      ),
  );
  const commands: Array<[string, string[]]> = [];
  if (operations.some((op) => ['image', 'pyramid', 'video'].includes(op)))
    commands.push(
      [process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version']],
      [process.env.FFPROBE_PATH ?? 'ffprobe', ['-version']],
    );
  if (operations.some((op) => ['image', 'pyramid'].includes(op)))
    commands.push(
      [process.env.EXIFTOOL_PATH ?? 'exiftool', ['-ver']],
      [process.env.HEIF_INFO_PATH ?? 'heif-info', ['--version']],
      [process.env.HEIF_CONVERT_PATH ?? 'heif-dec', ['--version']],
      [process.env.CAMERA_RAW_PYTHON ?? 'python3', ['-c', 'import rawpy, PIL']],
    );
  if (operations.some((op) => ['image', 'pyramid'].includes(op))) await assertCameraRawRuntime();
  for (const [command, args] of commands)
    execFileSync(command, args, { timeout: 10000, stdio: 'ignore' });
  if (operations.includes('video')) {
    if (!videoEncoder) throw new Error('VIDEO_ENCODER_REQUIRED');
    execFileSync(
      process.env.FFMPEG_PATH ?? 'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=256x256:r=1',
        '-frames:v',
        '1',
        ...cameraVideoEncodingArguments(videoEncoder),
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '2',
        '-f',
        'null',
        '-',
      ],
      { timeout: 30000, stdio: 'ignore', env: mediaSubprocessEnvironment() },
    );
  }
  const tokenPath = process.env.EAGLE_COMPUTE_NODE_TOKEN_FILE;
  if (!tokenPath) throw new Error('NODE_TOKEN_FILE_REQUIRED');
  const token = await readComputeToken(tokenPath);
  const threads = Number(process.env.EAGLE_COMPUTE_SHARP_THREADS ?? 1);
  if (!Number.isInteger(threads) || threads < 1 || threads > 8)
    throw new Error('INVALID_SHARP_THREADS');
  sharp.concurrency(threads);
  const port = Number(process.env.EAGLE_COMPUTE_NODE_PORT ?? 11437);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  const facesReady = operations.includes('faces');
  if (facesReady) {
    const probe = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#808080' },
    })
      .jpeg()
      .toBuffer();
    await inferPhotoFaces(probe);
  }
  const server = createRemoteMediaServer(
    token,
    Number(process.env.EAGLE_COMPUTE_NODE_CONCURRENCY ?? 1),
    facesReady,
    videoEncoder,
    operations,
  );
  server.listen(port, process.env.EAGLE_COMPUTE_NODE_BIND ?? '127.0.0.1');
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}
if (require.main === module)
  void main().catch((error: unknown) => {
    // Local service logs retain startup diagnostics; HTTP never exposes runtime errors.
    process.stderr.write(
      `Media agent startup failed: ${error instanceof Error ? error.stack : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  });
