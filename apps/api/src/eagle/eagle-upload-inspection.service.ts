import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';
import { parseBrowserCompatibleMp4Probe, type MediaVideoProbe } from './eagle-video-inspection';

const execFileAsync = promisify(execFile);

@Injectable()
export class EagleUploadInspectionService {
  constructor(private readonly storage: ObjectStorageService) {}

  async inspect(objectKey: string, mimeType: string) {
    const object = await this.storage.getObject(objectKey);
    if (!object.Body) throw new NotFoundException('上传后的对象不存在。');
    if (mimeType === 'video/mp4') {
      return { format: 'mp4', ...(await inspectVideo(object.Body as unknown as Readable)) };
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
        ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heif: 'image/heic' } as const)[
          metadata.format as 'jpeg' | 'png' | 'webp' | 'gif' | 'heif'
        ];
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
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('无法解码该图片，请确认文件完整且格式受支持。');
    }
  }
}

async function inspectVideo(stream: Readable) {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-video-inspect-'));
  const inputPath = join(directory, 'input.mp4');
  try {
    const hash = createHash('sha256');
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(stream, hashingStream, createWriteStream(inputPath, { flags: 'wx' }));
    const { stdout } = await execFileAsync(
      process.env.FFPROBE_PATH?.trim() || 'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', inputPath],
      { maxBuffer: 2 * 1024 * 1024, timeout: 120_000 },
    );
    return {
      sha256: hash.digest('hex'),
      ...parseBrowserCompatibleMp4Probe(JSON.parse(stdout) as MediaVideoProbe),
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('无法读取该 MP4 视频，请确认文件完整且编码受支持。');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
