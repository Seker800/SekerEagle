import { BadRequestException, Injectable } from '@nestjs/common';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';
import type { EagleMediaCapabilitiesDto } from './eagle-media-capability.dto';
import {
  EAGLE_IMAGE_MIME_BY_EXTENSION,
  EAGLE_VIDEO_MIME_BY_EXTENSION,
  expectedEagleMimeType,
  resolveEagleMediaType,
} from './eagle-media-capability';

const MEDIA_MAX_MB = 100;
const MEDIA_MAX_BYTES = MEDIA_MAX_MB * 1024 * 1024;

const CAPABILITIES: EagleMediaCapabilitiesDto = Object.freeze({
  version: 1 as const,
  images: Object.freeze({
    mimeTypes: Object.freeze([...new Set(EAGLE_IMAGE_MIME_BY_EXTENSION.values())]),
    extensions: Object.freeze([...EAGLE_IMAGE_MIME_BY_EXTENSION.keys()]),
    maxBytes: MEDIA_MAX_BYTES,
    maxPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS,
  }),
  videos: Object.freeze({
    mimeTypes: Object.freeze([...new Set(EAGLE_VIDEO_MIME_BY_EXTENSION.values())]),
    extensions: Object.freeze([...EAGLE_VIDEO_MIME_BY_EXTENSION.keys()]),
    maxBytes: MEDIA_MAX_BYTES,
    maxDurationMs: null,
  }),
}) as EagleMediaCapabilitiesDto;

export interface EagleUploadCandidate {
  fileName: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class EagleMediaCapabilityService {
  getCapabilities(): EagleMediaCapabilitiesDto {
    return CAPABILITIES;
  }

  assertUploadAllowed(candidate: EagleUploadCandidate): {
    mediaType: 'image' | 'video';
    mimeType: string;
  } {
    if (!Number.isSafeInteger(candidate.size) || candidate.size <= 0) {
      throw new BadRequestException('文件大小无效。');
    }
    const expectedMimeType = expectedEagleMimeType(candidate.fileName);
    if (!expectedMimeType) throw new BadRequestException('不支持该媒体格式。');
    if (
      candidate.mimeType.normalize('NFKC').trim().toLocaleLowerCase('en-US') !== expectedMimeType
    ) {
      throw new BadRequestException('文件扩展名与媒体类型不匹配。');
    }
    const resolved = resolveEagleMediaType(candidate)!;
    if (candidate.size > MEDIA_MAX_BYTES) {
      throw new BadRequestException(
        `${resolved.mediaType === 'image' ? '图片' : '视频'}大小不能超过 ${MEDIA_MAX_MB}MB。`,
      );
    }
    return resolved;
  }
}
