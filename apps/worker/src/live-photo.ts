import { parse } from 'exifr';
import { CAMERA_MAX_IMAGE_BYTES } from '@sekereagle/library-core';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readAppleLivePhotoIdentifier,
  readMotionPhotoRange,
  probeCameraVideo,
  transcodeCameraVideo,
  LIVE_PHOTO_MAX_DURATION_MS,
  LIVE_PHOTO_MAX_VIDEO_BYTES,
} from '@sekereagle/media-core';

export async function inspectLivePhotoImage(path: string, extractMotion = true) {
  const identifier = await readLivePhotoIdentifier(path);
  const base = {
    identifier,
    motion: null as null | { data: Buffer; width: number; height: number },
  };
  const handle = await open(path, 'r');
  let head: Buffer;
  try {
    const data = Buffer.alloc(Math.min(1024 * 1024, (await handle.stat()).size));
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    head = data.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const range =
    head[0] === 0xff && head[1] === 0xd8
      ? readMotionPhotoRange(head.toString('utf8'), (await stat(path)).size)
      : head.toString('ascii', 4, 8) === 'ftyp'
        ? await heicMotionRange(path)
        : null;
  if (!range) return base;
  if (!extractMotion) throw new Error('MOTION_COMPONENT_DEFERRED');
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-motion-photo-'));
  try {
    const input = join(directory, 'source.mp4'),
      output = join(directory, 'playback.mp4');
    await pipeline(
      createReadStream(path, { start: range.start, end: range.start + range.length - 1 }),
      createWriteStream(input, { flags: 'wx' }),
    );
    return { identifier, motion: await renderMotionFile(input, output) };
  } catch {
    return base;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function heicMotionRange(path: string): Promise<{ start: number; length: number } | null> {
  const handle = await open(path, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    let offset = 0,
      range: { start: number; length: number } | null = null;
    for (let count = 0; count < 4096 && offset < fileSize; count++) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) return null;
      const size32 = header.readUInt32BE(0),
        headerLength = size32 === 1 ? 16 : 8;
      if (bytesRead < headerLength) return null;
      const size =
        size32 === 1
          ? Number(header.readBigUInt64BE(8))
          : size32 === 0
            ? fileSize - offset
            : size32;
      if (!Number.isSafeInteger(size) || size < headerLength || offset + size > fileSize)
        return null;
      if (header.toString('ascii', 4, 8) === 'mpvd') {
        if (range || size - headerLength < 12 || size - headerLength > LIVE_PHOTO_MAX_VIDEO_BYTES)
          return null;
        range = { start: offset + headerLength, length: size - headerLength };
      }
      offset += size;
    }
    return offset === fileSize ? range : null;
  } finally {
    await handle.close();
  }
}

async function readLivePhotoIdentifier(input: string | Buffer) {
  let identifier: string | null = null;
  try {
    const metadata: unknown = await parse(input, {
      makerNote: true,
      xmp: false,
      icc: false,
      iptc: false,
      chunkSize: 65536,
      chunkLimit: 32,
    });
    const makerNote =
      metadata && typeof metadata === 'object'
        ? (metadata as Record<string, unknown>).makerNote
        : undefined;
    if (makerNote instanceof Uint8Array) identifier = readAppleLivePhotoIdentifier(makerNote);
  } catch {
    /* Optional camera metadata is not required for a static preview. */
  }
  return identifier;
}

/** JPEG camera metadata is bounded; only an explicitly declared motion tail is fetched. */
export async function inspectJpegLivePhoto(
  fileSize: number,
  readRange: (start: number, length: number) => Promise<Buffer>,
  renderMotion = renderMotionBytes,
) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 2 || fileSize > CAMERA_MAX_IMAGE_BYTES)
    throw new Error('LIVE_PHOTO_SIZE');
  const headLength = Math.min(1024 * 1024, fileSize);
  const head = await readRange(0, headLength);
  if (head.length !== headLength) throw new Error('LIVE_PHOTO_RANGE_LENGTH');
  if (head[0] !== 0xff || head[1] !== 0xd8) throw new Error('LIVE_PHOTO_JPEG_HEADER');
  const identifier = await readJpegIdentifier(head, fileSize, readRange);
  const range = readMotionPhotoRange(head.toString('utf8'), fileSize);
  if (!range) return { identifier, motion: null };
  const motion = await readRange(range.start, range.length);
  if (motion.length !== range.length) throw new Error('LIVE_PHOTO_RANGE_LENGTH');
  return { identifier, motion: await renderMotion(motion) };
}

/** Walk JPEG segment headers, skipping pixel/ICC payloads even when EXIF is stored late. */
async function readJpegIdentifier(
  head: Buffer,
  fileSize: number,
  readRange: (start: number, length: number) => Promise<Buffer>,
) {
  const read = async (start: number, length: number) => {
    if (start + length > fileSize) return null;
    const bytes =
      start + length <= head.length
        ? head.subarray(start, start + length)
        : await readRange(start, length);
    if (bytes.length !== length) throw new Error('LIVE_PHOTO_RANGE_LENGTH');
    return bytes;
  };
  let offset = 2;
  for (let count = 0; count < 4096 && offset < fileSize; count++) {
    const marker = await read(offset, 2);
    if (!marker || marker[0] !== 0xff || marker[1] === 0xda || marker[1] === 0xd9) return null;
    if (marker[1] === 0xff) {
      offset++;
      continue;
    }
    if (marker[1] === 0x01 || (marker[1]! >= 0xd0 && marker[1]! <= 0xd7)) {
      offset += 2;
      continue;
    }
    const header = await read(offset, 4);
    if (!header) return null;
    const length = header.readUInt16BE(2);
    if (length < 2 || offset + 2 + length > fileSize) return null;
    if (marker[1] === 0xe1) {
      const segment = await read(offset, 2 + length);
      if (segment && segment.toString('ascii', 4, 10) === 'Exif\0\0') {
        const identifier = await readLivePhotoIdentifier(
          Buffer.concat([Buffer.from([0xff, 0xd8]), segment, Buffer.from([0xff, 0xd9])]),
        );
        if (identifier) return identifier;
      }
    }
    offset += 2 + length;
  }
  return null;
}

async function renderMotionBytes(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-motion-photo-'));
  try {
    const input = join(directory, 'source.mp4'),
      output = join(directory, 'playback.mp4');
    await pipeline(Readable.from([bytes]), createWriteStream(input, { flags: 'wx' }));
    return await renderMotionFile(input, output);
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function renderMotionFile(input: string, output: string) {
  const video = await probeCameraVideo(input, 'video/mp4');
  if (video.durationMs > LIVE_PHOTO_MAX_DURATION_MS) return null;
  const playback = await transcodeCameraVideo(input, output, video.durationMs);
  if ((await stat(output)).size > LIVE_PHOTO_MAX_VIDEO_BYTES) return null;
  return { data: await readFile(output), width: playback.width, height: playback.height };
}

/** HEIC metadata may reference distant items: retain bounded streaming inspection, without image decoding. */
export async function inspectLivePhotoStream(
  source: AsyncIterable<Uint8Array>,
  expectedSha256: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-live-inspect-'));
  let size = 0;
  const hash = createHash('sha256');
  try {
    const path = join(directory, 'original');
    const budget = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(size > CAMERA_MAX_IMAGE_BYTES ? new Error('LIVE_PHOTO_SIZE') : null, chunk);
      },
    });
    await pipeline(Readable.from(source), budget, createWriteStream(path, { flags: 'wx' }));
    if (hash.digest('hex') !== expectedSha256) throw new Error('LIVE_PHOTO_HASH_MISMATCH');
    return await inspectLivePhotoImage(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
