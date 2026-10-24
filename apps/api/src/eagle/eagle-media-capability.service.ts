import {
  CAMERA_MAX_IMAGE_BYTES,
  CAMERA_MAX_DECODED_HEIF_PIXELS,
  CAMERA_MAX_RAW_PIXELS,
  CAMERA_MAX_VIDEO_BYTES,
  CAMERA_MAX_VIDEO_DURATION_MS,
} from '@sekereagle/library-core';
import { BadRequestException, Injectable } from '@nestjs/common';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';
import type { EagleMediaCapabilitiesDto } from './eagle-media-capability.dto';
import {
  EAGLE_IMAGE_MIME_BY_EXTENSION,
  EAGLE_VIDEO_MIME_BY_EXTENSION,
  expectedEagleMimeType,
  resolveEagleMediaType,
} from './eagle-media-capability';

/**
 * The list filter compares the stored inspection format, which differs from the upload
 * extension for a few aliases (jpg -> jpeg, heic -> heif, m4v -> mp4). Expose the exact values
 * instead of making every client duplicate that mapping.
 */
const STORED_IMAGE_FORMAT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heif',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
};

function firstExtensionByMime(byExtension: ReadonlyMap<string, string>) {
  const first = new Map<string, string>();
  for (const [extension, mime] of byExtension)
    if (!first.has(mime)) first.set(mime, extension.slice(1));
  return first;
}

function storedFormats(
  mimeTypes: string[],
  firstExtension: ReadonlyMap<string, string>,
  canonical: Record<string, string> = {},
) {
  return [
    ...new Set(mimeTypes.map((mime) => canonical[mime] ?? firstExtension.get(mime) ?? mime)),
  ].sort();
}

const CAPABILITIES: EagleMediaCapabilitiesDto = Object.freeze({
  version: 1 as const,
  images: Object.freeze({
    mimeTypes: Object.freeze([...new Set(EAGLE_IMAGE_MIME_BY_EXTENSION.values())]),
    extensions: Object.freeze([...EAGLE_IMAGE_MIME_BY_EXTENSION.keys()]),
    formats: Object.freeze(
      storedFormats(
        [...new Set(EAGLE_IMAGE_MIME_BY_EXTENSION.values())],
        firstExtensionByMime(EAGLE_IMAGE_MIME_BY_EXTENSION),
        STORED_IMAGE_FORMAT,
      ),
    ),
    maxBytes: CAMERA_MAX_IMAGE_BYTES,
    maxPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS,
    maxRawPixels: CAMERA_MAX_RAW_PIXELS,
    maxHeifPixels: CAMERA_MAX_DECODED_HEIF_PIXELS,
  }),
  videos: Object.freeze({
    mimeTypes: Object.freeze([...new Set(EAGLE_VIDEO_MIME_BY_EXTENSION.values())]),
    extensions: Object.freeze([...EAGLE_VIDEO_MIME_BY_EXTENSION.keys()]),
    formats: Object.freeze(
      storedFormats(
        [...new Set(EAGLE_VIDEO_MIME_BY_EXTENSION.values())],
        firstExtensionByMime(EAGLE_VIDEO_MIME_BY_EXTENSION),
      ),
    ),
    maxBytes: CAMERA_MAX_VIDEO_BYTES,
    maxDurationMs: CAMERA_MAX_VIDEO_DURATION_MS,
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
    const resolved = resolveEagleMediaType(candidate);
    if (!resolved) throw new BadRequestException('文件扩展名与媒体类型不匹配。');
    const maxBytes =
      resolved.mediaType === 'image' ? CAMERA_MAX_IMAGE_BYTES : CAMERA_MAX_VIDEO_BYTES;
    if (candidate.size > maxBytes) {
      throw new BadRequestException(
        `${resolved.mediaType === 'image' ? '图片' : '视频'}大小不能超过 ${resolved.mediaType === 'image' ? `${maxBytes / 1_000_000} MB` : `${maxBytes / 1_000_000_000} GB`}。`,
      );
    }
    return resolved;
  }
}
