import { execFileSync } from 'node:child_process';
import { open, constants } from 'node:fs/promises';
import sharp from 'sharp';
import { inferPhotoFaces } from './photo-faces';
import { createRemoteMediaServer } from './remote-media';
async function main() {
  // Do not advertise a broad image capability from a half-installed runtime.
  for (const [command, args] of [
    [process.env.EXIFTOOL_PATH ?? 'exiftool', ['-ver']],
    [process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version']],
    [process.env.FFPROBE_PATH ?? 'ffprobe', ['-version']],
    [process.env.HEIF_INFO_PATH ?? 'heif-info', ['--version']],
    [process.env.HEIF_CONVERT_PATH ?? 'heif-dec', ['--version']],
    [process.env.CAMERA_RAW_PYTHON ?? 'python3', ['-c', 'import rawpy, PIL']],
  ] as const)
    execFileSync(command, [...args], { timeout: 10000, stdio: 'ignore' });
  const path = process.env.EAGLE_COMPUTE_NODE_TOKEN_FILE;
  if (!path) throw new Error('NODE_TOKEN_FILE_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let token: string;
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > 1024 ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('PRIVATE_TOKEN_REQUIRED');
    token = (await handle.readFile('utf8')).trim();
  } finally {
    await handle.close();
  }
  const port = Number(process.env.EAGLE_COMPUTE_NODE_PORT ?? 11437);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  const facesReady = Boolean(process.env.PHOTO_FACE_PYTHON || process.env.PHOTO_FACE_MODEL_DIR);
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
  );
  server.listen(port, process.env.EAGLE_COMPUTE_NODE_BIND ?? '127.0.0.1');
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}
if (require.main === module)
  void main().catch(() => {
    process.stderr.write('Media agent startup failed; inspect private runtime configuration.\n');
    process.exitCode = 1;
  });
