import { extname } from 'node:path';

export const EAGLE_IMAGE_MIME_BY_EXTENSION = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
]);

export const EAGLE_VIDEO_MIME_BY_EXTENSION = new Map<string, string>([['.mp4', 'video/mp4']]);

export function expectedEagleMimeType(fileName: string): string | null {
  const extension = extname(fileName.normalize('NFKC')).toLocaleLowerCase('en-US');
  return (
    EAGLE_IMAGE_MIME_BY_EXTENSION.get(extension) ??
    EAGLE_VIDEO_MIME_BY_EXTENSION.get(extension) ??
    null
  );
}

export function resolveEagleMediaType(candidate: {
  fileName: string;
  mimeType: string;
}): { mediaType: 'image' | 'video'; mimeType: string } | null {
  const extension = extname(candidate.fileName.normalize('NFKC')).toLocaleLowerCase('en-US');
  const mimeType = candidate.mimeType.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const imageMimeType = EAGLE_IMAGE_MIME_BY_EXTENSION.get(extension);
  const expectedMimeType = expectedEagleMimeType(candidate.fileName);
  if (!expectedMimeType || mimeType !== expectedMimeType) return null;
  return { mediaType: imageMimeType ? 'image' : 'video', mimeType: expectedMimeType };
}

export function isSupportedEagleMedia(candidate: { fileName: string; mimeType: string }): boolean {
  return resolveEagleMediaType(candidate) !== null;
}
