import type { EagleAssetListItem, EagleAssetUpdate } from '../../lib/eagle-api';
// Metadata rowVersion and mediaRevision are independent clocks. Processing writes
// within one media version use updatedAt; equal-time facts cannot regress READY.
export const assetFactTime = (value: string) => Date.parse(value) || 0;
const statusRank = (value: string) => (value === 'READY' ? 2 : value === 'FAILED' ? 1 : 0);
export function canMergeEagleMedia(
  current: EagleAssetListItem,
  incoming: EagleAssetListItem | EagleAssetUpdate,
  mediaUpdatedAt = current.updatedAt,
) {
  if (incoming.mediaRevision !== current.mediaRevision)
    return incoming.mediaRevision > current.mediaRevision;
  if (assetFactTime(incoming.updatedAt) !== assetFactTime(mediaUpdatedAt))
    return assetFactTime(incoming.updatedAt) > assetFactTime(mediaUpdatedAt);
  if (statusRank(incoming.lifecycleStatus) !== statusRank(current.lifecycleStatus))
    return statusRank(incoming.lifecycleStatus) > statusRank(current.lifecycleStatus);
  return (
    current.renditions.every((r) => incoming.renditions.some((next) => next.id === r.id)) &&
    incoming.renditions.length > current.renditions.length
  );
}
const mediaFacts = (asset: EagleAssetListItem) => ({
  originalName: asset.originalName,
  mimeType: asset.mimeType,
  format: asset.format,
  byteSize: asset.byteSize,
  width: asset.width,
  height: asset.height,
  durationMs: asset.durationMs,
  lifecycleStatus: asset.lifecycleStatus,
  mediaErrorCode: asset.mediaErrorCode,
  mediaRevision: asset.mediaRevision,
  renditions: asset.renditions,
  photoMetadata: asset.photoMetadata,
  photoLocation: asset.photoLocation,
  chronologicalAt: asset.chronologicalAt,
  livePhotoMotion: asset.livePhotoMotion,
});

function selectMetadata<T extends EagleAssetListItem>(
  current: T,
  incoming: T,
  metadataUpdatedAt = current.updatedAt,
) {
  return incoming.rowVersion > current.rowVersion ||
    (incoming.rowVersion === current.rowVersion &&
      assetFactTime(incoming.updatedAt) >= assetFactTime(metadataUpdatedAt))
    ? incoming
    : current;
}
export function mergeEagleAssetFacts<T extends EagleAssetListItem>(
  current: T,
  incoming: T,
  metadataUpdatedAt = current.updatedAt,
  mediaUpdatedAt = current.updatedAt,
): { asset: T; metadataAccepted: boolean; mediaAccepted: boolean } {
  const metadata = selectMetadata(current, incoming, metadataUpdatedAt);
  const media = canMergeEagleMedia(current, incoming, mediaUpdatedAt) ? incoming : current;
  if (metadata === current && media === current)
    return { asset: current, metadataAccepted: false, mediaAccepted: false };
  return {
    asset: {
      ...metadata,
      ...mediaFacts(media),
      updatedAt:
        assetFactTime(incoming.updatedAt) > assetFactTime(current.updatedAt)
          ? incoming.updatedAt
          : current.updatedAt,
    },
    metadataAccepted: metadata === incoming,
    mediaAccepted: media === incoming,
  };
}
