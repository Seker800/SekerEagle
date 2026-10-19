import { parse } from 'exifr';
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

export async function inspectLivePhotoImage(path: string) {
  let identifier: string | null = null;
  try {
    const metadata: unknown = await parse(path, {
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
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-motion-photo-'));
  try {
    const input = join(directory, 'source.mp4'),
      output = join(directory, 'playback.mp4');
    await pipeline(
      createReadStream(path, { start: range.start, end: range.start + range.length - 1 }),
      createWriteStream(input, { flags: 'wx' }),
    );
    const video = await probeCameraVideo(input, 'video/mp4');
    if (video.durationMs > LIVE_PHOTO_MAX_DURATION_MS) return base;
    const playback = await transcodeCameraVideo(input, output, video.durationMs);
    if ((await stat(output)).size > LIVE_PHOTO_MAX_VIDEO_BYTES) return base;
    return {
      identifier,
      motion: { data: await readFile(output), width: playback.width, height: playback.height },
    };
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
