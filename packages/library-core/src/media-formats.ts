/** Shared format policy for both libraries and every ingestion client. */
export const CAMERA_MAX_IMAGE_BYTES = 250 * 1024 * 1024;
export const CAMERA_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const CAMERA_MAX_VIDEO_DURATION_MS = 4 * 3600 * 1000;
export const CAMERA_MAX_IMAGE_PIXELS = 50_000_000;
export type CameraMediaKind = 'image' | 'raw' | 'video';
export interface CameraMediaFormat {
  extension: string;
  mimeType: string;
  kind: CameraMediaKind;
}
const entries: Array<[CameraMediaKind, string, string]> = [
  ['image', 'jpg,jpeg', 'image/jpeg'],
  ['image', 'png', 'image/png'],
  ['image', 'webp', 'image/webp'],
  ['image', 'gif', 'image/gif'],
  ['image', 'avif', 'image/avif'],
  ['image', 'heic', 'image/heic'],
  ['image', 'heif', 'image/heif'],
  ['image', 'tif,tiff', 'image/tiff'],
  ['raw', 'dng', 'image/x-adobe-dng'],
  ['raw', 'cr2', 'image/x-canon-cr2'],
  ['raw', 'cr3', 'image/x-canon-cr3'],
  ['raw', 'crw', 'image/x-canon-crw'],
  ['raw', 'nef', 'image/x-nikon-nef'],
  ['raw', 'nrw', 'image/x-nikon-nrw'],
  ['raw', 'arw', 'image/x-sony-arw'],
  ['raw', 'sr2', 'image/x-sony-sr2'],
  ['raw', 'raf', 'image/x-fuji-raf'],
  ['raw', 'orf', 'image/x-olympus-orf'],
  ['raw', 'rw2', 'image/x-panasonic-rw2'],
  ['raw', 'rwl', 'image/x-leica-rwl'],
  ['raw', 'pef', 'image/x-pentax-pef'],
  ['raw', 'srw', 'image/x-samsung-srw'],
  ['raw', 'kdc', 'image/x-kodak-kdc'],
  ['raw', 'raw', 'image/x-raw'],
  ['video', 'mp4,m4v', 'video/mp4'],
  ['video', 'mov', 'video/quicktime'],
  ['video', 'mts,m2ts', 'video/mp2t'],
  ['video', 'avi', 'video/x-msvideo'],
  ['video', 'mxf', 'application/mxf'],
  ['video', 'mpg,mpeg', 'video/mpeg'],
];
export const CAMERA_MEDIA_FORMATS: readonly CameraMediaFormat[] = Object.freeze(
  entries.flatMap(([kind, extensions, mimeType]) =>
    extensions
      .split(',')
      .map((extension) => Object.freeze({ kind, extension: `.${extension}`, mimeType })),
  ),
);
export function cameraMediaFormat(fileName: string): CameraMediaFormat | null {
  const extension = fileName
    .normalize('NFKC')
    .toLowerCase()
    .match(/\.[^.\\/]+$/)?.[0];
  return CAMERA_MEDIA_FORMATS.find((format) => format.extension === extension) ?? null;
}
export function normalizeCameraMimeType(fileName: string, mimeType: string): string | null {
  const format = cameraMediaFormat(fileName);
  if (!format) return null;
  const declared = mimeType.trim().toLowerCase();
  if (declared === '' || declared === 'application/octet-stream' || declared === format.mimeType)
    return format.mimeType;
  const aliases: Record<string, string[]> = {
    'image/x-adobe-dng': ['image/dng'],
    'video/mp4': ['video/x-m4v'],
    'video/x-msvideo': ['video/avi'],
    'application/mxf': ['video/mxf'],
    'image/tiff': ['image/x-tiff'],
  };
  return aliases[format.mimeType]?.includes(declared) ? format.mimeType : null;
}
export function isCameraRawMime(mimeType: string): boolean {
  return CAMERA_MEDIA_FORMATS.some(
    (format) => format.kind === 'raw' && format.mimeType === mimeType,
  );
}
export function isCameraVideoMime(mimeType: string): boolean {
  return CAMERA_MEDIA_FORMATS.some(
    (format) => format.kind === 'video' && format.mimeType === mimeType,
  );
}
