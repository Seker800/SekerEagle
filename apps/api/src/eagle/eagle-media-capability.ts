import {
  CAMERA_MEDIA_FORMATS,
  cameraMediaFormat,
  normalizeCameraMimeType,
} from '@sekereagle/library-core';

export const EAGLE_IMAGE_MIME_BY_EXTENSION = new Map(
  CAMERA_MEDIA_FORMATS.filter((format) => format.kind !== 'video').map(
    ({ extension, mimeType }) => [extension, mimeType],
  ),
);
export const EAGLE_VIDEO_MIME_BY_EXTENSION = new Map(
  CAMERA_MEDIA_FORMATS.filter((format) => format.kind === 'video').map(
    ({ extension, mimeType }) => [extension, mimeType],
  ),
);
export function expectedEagleMimeType(fileName: string): string | null {
  return cameraMediaFormat(fileName)?.mimeType ?? null;
}
export function resolveEagleMediaType(candidate: {
  fileName: string;
  mimeType: string;
}): { mediaType: 'image' | 'video'; mimeType: string } | null {
  const format = cameraMediaFormat(candidate.fileName);
  const mimeType = normalizeCameraMimeType(candidate.fileName, candidate.mimeType);
  return format && mimeType
    ? { mediaType: format.kind === 'video' ? 'video' : 'image', mimeType }
    : null;
}
export function isSupportedEagleMedia(candidate: { fileName: string; mimeType: string }): boolean {
  return resolveEagleMediaType(candidate) !== null;
}
