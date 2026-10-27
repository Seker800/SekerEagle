import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  CAMERA_MAX_VIDEO_BYTES,
  CAMERA_MAX_VIDEO_DURATION_MS,
  isCameraVideoMime,
} from '@sekereagle/library-core';
import {
  probeCameraVideo,
  transcodeCameraVideo,
  CAMERA_VIDEO_INPUT_OPTIONS,
  mediaSubprocessEnvironment,
  normalizeLivePhotoIdentifier,
  type CameraVideoEncoder,
} from '@sekereagle/media-core';
export interface VideoWork {
  mimeType: string;
  stage: 'POSTER' | 'PLAYBACK' | 'FULL';
}
export interface VideoManifest {
  sha256: string;
  work: VideoWork;
  metadata: Awaited<ReturnType<typeof probeCameraVideo>>;
  playbackMetadata: Awaited<ReturnType<typeof probeCameraVideo>> | null;
}
export function validateVideoWork(input: unknown): VideoWork {
  const value = input as VideoWork;
  if (
    !value ||
    Object.keys(value).some((k) => !['mimeType', 'stage'].includes(k)) ||
    typeof value.mimeType !== 'string' ||
    !isCameraVideoMime(value.mimeType) ||
    !['POSTER', 'PLAYBACK', 'FULL'].includes(value.stage)
  )
    throw new Error('INVALID_VIDEO_WORK');
  return { mimeType: value.mimeType, stage: value.stage };
}
export function validateVideoManifest(input: unknown, work: VideoWork): VideoManifest {
  const value = input as VideoManifest;
  const valid = (m: VideoManifest['metadata'] | null, maxSize: number) =>
    m &&
    Number.isSafeInteger(m.width) &&
    Number.isSafeInteger(m.height) &&
    m.width > 0 &&
    m.height > 0 &&
    m.width <= maxSize &&
    m.height <= maxSize &&
    m.width * m.height <= 100_000_000 &&
    Number.isSafeInteger(m.durationMs) &&
    m.durationMs > 0 &&
    m.durationMs <= CAMERA_MAX_VIDEO_DURATION_MS &&
    (!m.livePhotoIdentifier ||
      normalizeLivePhotoIdentifier(m.livePhotoIdentifier) === m.livePhotoIdentifier);
  if (
    !value ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    value.work?.mimeType !== work.mimeType ||
    value.work?.stage !== work.stage ||
    !valid(value.metadata, 16384) ||
    (work.stage === 'POSTER'
      ? value.playbackMetadata !== null
      : !valid(value.playbackMetadata, 1920) ||
        Math.abs(value.playbackMetadata!.durationMs - value.metadata.durationMs) > 1000)
  )
    throw new Error('INVALID_VIDEO_RESULT');
  return value;
}
export async function renderVideoWork(
  source: AsyncIterable<Uint8Array>,
  work: VideoWork,
  directory: string,
  encoder: CameraVideoEncoder = 'libx264',
) {
  validateVideoWork(work);
  const inputPath = join(directory, 'input.mp4'),
    posterPath = join(directory, 'poster.jpg'),
    previewPath = join(directory, 'preview.mp4');
  const hash = createHash('sha256');
  let size = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > CAMERA_MAX_VIDEO_BYTES) return callback(new Error('VIDEO_SIZE_LIMIT_EXCEEDED'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.from(source),
    tap,
    createWriteStream(inputPath, { flags: 'wx', mode: 0o600 }),
  );
  const sha256 = hash.digest('hex');
  const metadata = await probeCameraVideo(inputPath, work.mimeType);
  const playbackMetadata =
    work.stage === 'POSTER'
      ? null
      : await transcodeCameraVideo(inputPath, previewPath, metadata.durationMs, encoder);
  if (work.stage !== 'PLAYBACK')
    await promisify(execFile)(
      process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-ss',
        '0',
        ...CAMERA_VIDEO_INPUT_OPTIONS,
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        "scale='min(800,iw)':'min(800,ih)':force_original_aspect_ratio=decrease",
        '-q:v',
        '3',
        posterPath,
      ],
      { env: mediaSubprocessEnvironment(), timeout: 120000 },
    );
  return {
    manifest: { sha256, work, metadata, playbackMetadata } satisfies VideoManifest,
    files: [
      ...(work.stage !== 'PLAYBACK' ? ['poster.jpg'] : []),
      ...(playbackMetadata ? ['preview.mp4'] : []),
    ],
  };
}
export async function validateVideoArtifacts(
  value: VideoManifest,
  files: { name: string; path: string }[],
) {
  const expected = [
    ...(value.work.stage !== 'PLAYBACK' ? ['poster.jpg'] : []),
    ...(value.playbackMetadata ? ['preview.mp4'] : []),
  ];
  if (
    files.length !== expected.length ||
    new Set(files.map((f) => f.name)).size !== files.length ||
    files.some((f) => !expected.includes(f.name))
  )
    throw new Error('INCOMPLETE_VIDEO_RESULT');
  for (const file of files) {
    if (file.name === 'poster.jpg') {
      if ((await stat(file.path)).size > 4 * 1024 ** 2) throw new Error('INVALID_VIDEO_POSTER');
      const image = await sharp(await readFile(file.path), {
        limitInputPixels: 800 * 800,
      }).metadata();
      if (
        image.format !== 'jpeg' ||
        !image.width ||
        !image.height ||
        image.width > 800 ||
        image.height > 800
      )
        throw new Error('INVALID_VIDEO_POSTER');
    } else {
      const actual = await probeCameraVideo(file.path, 'video/mp4'),
        wanted = value.playbackMetadata!;
      if (
        (await stat(file.path)).size >= 1024 ** 3 ||
        actual.width !== wanted.width ||
        actual.height !== wanted.height ||
        Math.abs(actual.durationMs - wanted.durationMs) > 1
      )
        throw new Error('INVALID_VIDEO_PLAYBACK');
    }
  }
}
