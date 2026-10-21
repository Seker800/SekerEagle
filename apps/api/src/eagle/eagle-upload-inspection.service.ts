import { inspectionFailure } from './media-inspection-error';
import { mediaInspectionBudget } from './media-inspection-budget';
import {
  CAMERA_MEDIA_FORMATS,
  CAMERA_MAX_IMAGE_BYTES,
  CAMERA_MAX_VIDEO_BYTES,
  isCameraRawMime,
  isCameraVideoMime,
} from '@sekereagle/library-core';
import { readCameraRaw, probeCameraVideo, probeHeifFile } from '@sekereagle/media-core';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';

sharp.cache({ memory: 64 });
sharp.concurrency(1);

@Injectable()
export class EagleUploadInspectionService {
  constructor(private readonly storage: ObjectStorageService) {}

  inspect(objectKey: string, mimeType: string, ownerId = objectKey) {
    return mediaInspectionBudget.run(ownerId, () => this.inspectWithinBudget(objectKey, mimeType));
  }

  private async inspectWithinBudget(objectKey: string, mimeType: string) {
    const object = await this.storage.getObject(objectKey);
    if (!object.Body) throw new NotFoundException('上传后的对象不存在。');
    if (mimeType === 'image/heic' || mimeType === 'image/heif')
      return inspectHeifImage(object.Body as unknown as Readable);
    if (isCameraVideoMime(mimeType) || isCameraRawMime(mimeType)) {
      return inspectCameraFile(object.Body as unknown as Readable, mimeType);
    }
    const hash = createHash('sha256');
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const image = sharp({
      failOn: 'warning',
      limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS,
    });
    const metadataPromise = image.metadata();
    try {
      const [metadata] = await Promise.all([
        metadataPromise,
        pipeline(object.Body as unknown as Readable, hashingStream, image),
      ]);
      const detectedMimeType: string | undefined =
        metadata.mediaType ??
        (
          {
            avif: 'image/avif',
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            gif: 'image/gif',
            heif: 'image/heic',
            tiff: 'image/tiff',
          } as const
        )[metadata.format as 'avif' | 'jpeg' | 'png' | 'webp' | 'gif' | 'heif' | 'tiff'];
      const heifAlias =
        metadata.format === 'heif' &&
        (mimeType === 'image/heic' || mimeType === 'image/heif') &&
        (detectedMimeType === 'image/heic' || detectedMimeType === 'image/heif');
      if ((!heifAlias && detectedMimeType !== mimeType) || !metadata.width || !metadata.height) {
        throw new BadRequestException('图片内容与声明格式不匹配。');
      }
      return {
        sha256: hash.digest('hex'),
        format: metadata.format,
        width: metadata.autoOrient.width ?? metadata.width,
        height: metadata.autoOrient.height ?? metadata.height,
        durationMs: null,
      };
    } catch (error) {
      throw inspectionFailure(error, 'image');
    }
  }
}

async function inspectCameraFile(stream: Readable, mimeType: string) {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-camera-inspect-'));
  const inputPath = join(directory, 'input');
  const raw = isCameraRawMime(mimeType);
  try {
    const hash = createHash('sha256');
    let byteSize = 0;
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (byteSize > (raw ? CAMERA_MAX_IMAGE_BYTES : CAMERA_MAX_VIDEO_BYTES))
          return callback(new BadRequestException('媒体内容超出安全大小限制。'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(stream, hashingStream, createWriteStream(inputPath, { flags: 'wx' }));
    const metadata = raw
      ? { ...(await readCameraRaw(inputPath)), durationMs: null }
      : await probeCameraVideo(inputPath, mimeType);
    const format = CAMERA_MEDIA_FORMATS.find(
      (entry) => entry.mimeType === mimeType,
    )!.extension.slice(1);
    return { sha256: hash.digest('hex'), format, ...metadata };
  } catch (error) {
    throw inspectionFailure(error, raw ? 'raw' : 'video');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function inspectHeifImage(stream: Readable) {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heif-inspect-'));
  const inputPath = join(directory, 'original.heic');
  const hash = createHash('sha256');
  let byteSize = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > CAMERA_MAX_IMAGE_BYTES)
        return callback(new BadRequestException('媒体内容超出安全大小限制。'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, tap, createWriteStream(inputPath, { flags: 'wx' }));
    const metadata = await probeHeifFile(inputPath);
    return {
      sha256: hash.digest('hex'),
      format: 'heif',
      width: metadata.width,
      height: metadata.height,
      durationMs: null,
    };
  } catch (error) {
    throw inspectionFailure(error, 'image');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
