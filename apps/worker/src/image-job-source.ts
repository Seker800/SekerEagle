import { isCameraRawMime } from '@sekereagle/library-core';
import type { EagleMediaJobKind } from './processing-policy';

interface ImageSourceAsset {
  originalObjectKey: string;
  mimeType: string;
  mediaRevision: number;
  sha256?: string | null;
  renditions: Array<{
    kind: string;
    variant?: string;
    revision: number;
    status: string;
    storageKey: string;
    mimeType: string;
  }>;
}

export function selectImageJobSource(
  asset: ImageSourceAsset,
  kind: EagleMediaJobKind,
  processorVersion?: string,
) {
  if (
    kind === 'GENERATE_EMBEDDING' ||
    kind === 'ANALYZE_PHOTO_FACES' ||
    (kind === 'GENERATE_RENDITIONS' &&
      processorVersion === 'photo-source-details-v1' &&
      !isCameraRawMime(asset.mimeType) &&
      Boolean(asset.sha256))
  ) {
    const preview = asset.renditions.find(
      (rendition) =>
        rendition.kind === 'PREVIEW' &&
        rendition.variant !== 'edit' &&
        rendition.mimeType.startsWith('image/') &&
        rendition.revision === asset.mediaRevision &&
        rendition.status === 'READY',
    );
    if (!preview) throw new Error('READY_PREVIEW_MISSING');
    return {
      storageKey: preview.storageKey,
      mimeType: preview.mimeType,
      verifiesOriginalHash: false,
    };
  }
  if (kind === 'EXTRACT_COLOR_PALETTE') {
    const thumbnail = asset.renditions.find(
      (rendition) =>
        rendition.kind === 'THUMBNAIL' &&
        rendition.revision === asset.mediaRevision &&
        rendition.status === 'READY',
    );
    if (!thumbnail) throw new Error('READY_THUMBNAIL_MISSING');
    return {
      storageKey: thumbnail.storageKey,
      mimeType: thumbnail.mimeType,
      verifiesOriginalHash: false,
    };
  }
  return {
    storageKey: asset.originalObjectKey,
    mimeType: asset.mimeType,
    verifiesOriginalHash: true,
  };
}
