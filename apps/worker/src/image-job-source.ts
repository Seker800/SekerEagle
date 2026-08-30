import type { EagleMediaJobKind } from './processing-policy';

interface ImageSourceAsset {
  originalObjectKey: string;
  mimeType: string;
  mediaRevision: number;
  renditions: Array<{
    kind: string;
    revision: number;
    status: string;
    storageKey: string;
    mimeType: string;
  }>;
}

export function selectImageJobSource(asset: ImageSourceAsset, kind: EagleMediaJobKind) {
  if (kind === 'GENERATE_EMBEDDING' || kind === 'GENERATE_AI_TAGS') {
    const preview = asset.renditions.find(
      (rendition) =>
        rendition.kind === 'PREVIEW' &&
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
