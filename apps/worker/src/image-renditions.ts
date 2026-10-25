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
export function imageRenditionSpecs(
  mimeType: string,
  purpose: 'ALL' | 'BROWSE' | 'DETAILS' = 'ALL',
): ImageRenditionSpec[] {
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
  return specs.filter(
    (spec) =>
      purpose === 'ALL' ||
      (purpose === 'DETAILS' ? spec.variant === 'edit' : spec.variant !== 'edit'),
  );
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

/** Camera previews are display thumbnails, never an editing source. */
export function renditionSource<T>(
  spec: Pick<ImageRenditionSpec, 'kind'>,
  developed: T,
  embeddedThumbnail?: T,
): T {
  return spec.kind === 'THUMBNAIL' ? (embeddedThumbnail ?? developed) : developed;
}

/** Only the normal browse repair may reuse published outputs; explicit refreshes remain explicit. */
export function canReuseImageBrowsing(
  job: { kind: string; processorVersion: string; assetRevision: number },
  asset: {
    lifecycleStatus: string;
    sha256: string | null;
    width: number | null;
    height: number | null;
    renditions: Array<{ kind: string; variant?: string; revision: number; status?: string }>;
  },
): boolean {
  return (
    job.kind === 'GENERATE_RENDITIONS' &&
    job.processorVersion === 'rendition-v2' &&
    asset.lifecycleStatus === 'READY' &&
    Boolean(asset.sha256 && asset.width && asset.height) &&
    [
      ['PREVIEW', 'default'],
      ['THUMBNAIL', '256'],
      ['THUMBNAIL', '512'],
    ].every(([kind, variant]) =>
      asset.renditions.some(
        (r) =>
          r.kind === kind &&
          r.variant === variant &&
          r.revision === job.assetRevision &&
          r.status === 'READY',
      ),
    )
  );
}
