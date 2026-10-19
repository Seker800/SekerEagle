import { CAMERA_RAW_EDIT_MAX_SIZE, isCameraRawMime } from '@sekereagle/library-core';
import type { CameraDimensions } from '@sekereagle/media-core';
import type { WebpOptions } from 'sharp';

interface ImageRenditionSpec {
  kind: 'PREVIEW' | 'THUMBNAIL';
  variant: string;
  maxSize: number;
  encoding: WebpOptions;
}

/** One rendition policy for materials and photos, independent of job orchestration. */
export function imageRenditionSpecs(mimeType: string): ImageRenditionSpec[] {
  const specs: ImageRenditionSpec[] = [
    { kind: 'PREVIEW', variant: 'default', maxSize: 1600, encoding: { quality: 86 } },
    { kind: 'THUMBNAIL', variant: '256', maxSize: 256, encoding: { quality: 78 } },
    { kind: 'THUMBNAIL', variant: '512', maxSize: 512, encoding: { quality: 78 } },
  ];
  if (isCameraRawMime(mimeType))
    specs.push({
      kind: 'PREVIEW',
      variant: 'edit',
      maxSize: CAMERA_RAW_EDIT_MAX_SIZE,
      encoding: { lossless: true },
    });
  return specs;
}

export function catalogImageDimensions(
  decoded: { width?: number; height?: number; autoOrient?: { width: number; height: number } },
  original?: CameraDimensions,
) {
  return {
    width: original?.width ?? decoded.autoOrient?.width ?? decoded.width,
    height: original?.height ?? decoded.autoOrient?.height ?? decoded.height,
  };
}
