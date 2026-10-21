import { isCameraRawMime } from '@sekereagle/library-core';
import { libraryApiPath } from '../../lib/library-api-scope';
import { getEagleAssetContentUrl, getEagleRenditionContentUrl } from '../../lib/eagle-api';
import { type EagleAssetListItem, type EaglePyramidDescriptor } from '../../lib/eagle-api';
import { resolveEagleMediaPath } from '../../lib/media-resolver';

const IMAGE_PYRAMID_DIMENSION_THRESHOLD = 4_096;
const IMAGE_PYRAMID_PIXEL_THRESHOLD = 16_000_000;

export function getEaglePreviewContentUrl(asset: EagleAssetListItem): string | null {
  const currentRenditions = asset.renditions.filter(
    (rendition) => rendition.revision === asset.mediaRevision,
  );
  const selected =
    currentRenditions.find(
      ({ kind, mimeType, variant }) =>
        variant !== 'edit' &&
        kind === 'PREVIEW' &&
        (isVideoAsset(asset) || !mimeType || mimeType.startsWith('image/')),
    ) ?? currentRenditions.find(({ kind }) => kind === 'THUMBNAIL');
  return selected
    ? getEagleRenditionContentUrl(asset.id, selected.id, selected.kind, asset.libraryMode)
    : null;
}

/** Explicit editing may use originals only for browser-native formats. RAW uses bounded sRGB. */
export function getEagleEditContentUrl(asset: EagleAssetListItem): string | null {
  if (asset.lifecycleStatus !== 'READY' || asset.deletedAt) return null;
  if (['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType))
    return getEagleAssetContentUrl(asset.id, asset.libraryMode);
  if (!isCameraRawMime(asset.mimeType)) return null;
  const edit = asset.renditions.find(
    (row) =>
      row.revision === asset.mediaRevision &&
      row.kind === 'PREVIEW' &&
      row.variant === 'edit' &&
      row.mimeType === 'image/webp',
  );
  return edit ? getEagleRenditionContentUrl(asset.id, edit.id, edit.kind, asset.libraryMode) : null;
}

export function createEagleTileSource(descriptor: EaglePyramidDescriptor) {
  return {
    width: descriptor.width,
    height: descriptor.height,
    tileSize: descriptor.tileSize,
    tileOverlap: descriptor.overlap,
    minLevel: 0,
    maxLevel: descriptor.maxLevel,
    getTileUrl(level: number, x: number, y: number) {
      return resolveEagleMediaPath(
        descriptor.tileUrlTemplate
          .replace('{level}', String(level))
          .replace('{x}', String(x))
          .replace('{y}', String(y)),
      );
    },
  };
}

export function createEaglePreviewTileSource(url: string) {
  return { type: 'image' as const, url };
}

/**
 * Client-side request optimization. The API remains authoritative about whether
 * a current READY pyramid exists; these bounds mirror the media job policy.
 */
export function needsEagleImagePyramid(width: number | null, height: number | null): boolean {
  if (width === null || height === null) return false;
  return (
    Math.max(width, height) > IMAGE_PYRAMID_DIMENSION_THRESHOLD ||
    width * height > IMAGE_PYRAMID_PIXEL_THRESHOLD
  );
}

/** Camera originals are for download; browser playback uses the current normalized copy. */
export function getEagleVideoContentUrl(asset: EagleAssetListItem): string | null {
  const playback = asset.renditions.find(
    (rendition) =>
      rendition.kind === 'PREVIEW' &&
      rendition.revision === asset.mediaRevision &&
      rendition.mimeType === 'video/mp4',
  );
  if (playback)
    return libraryApiPath(
      `/api/eagle/assets/${encodeURIComponent(asset.id)}/renditions/${encodeURIComponent(playback.id)}`,
      asset.libraryMode ?? 'MATERIAL',
    );
  if (
    asset.renditions.some(
      (row) =>
        row.revision === asset.mediaRevision &&
        row.kind === 'THUMBNAIL' &&
        row.variant === 'poster',
    )
  )
    return null;
  // Existing H.264-only MP4 assets predate explicit video poster variants.
  return asset.mimeType === 'video/mp4' && asset.lifecycleStatus === 'READY'
    ? getEagleAssetContentUrl(asset.id, asset.libraryMode)
    : null;
}

function isVideoAsset(asset: EagleAssetListItem) {
  return !asset.mimeType.startsWith('image/');
}
export function getEagleLivePhotoContentUrl(asset: EagleAssetListItem): string | null {
  if (!asset.mimeType.startsWith('image/')) return null;
  const embedded = asset.renditions.find(
    (row) =>
      row.kind === 'PREVIEW' &&
      row.mimeType === 'video/mp4' &&
      row.revision === asset.mediaRevision,
  );
  const motion = embedded ? { assetId: asset.id, renditionId: embedded.id } : asset.livePhotoMotion;
  return motion
    ? libraryApiPath(
        `/api/eagle/assets/${encodeURIComponent(motion.assetId)}/renditions/${encodeURIComponent(motion.renditionId)}`,
        asset.libraryMode ?? 'MATERIAL',
      )
    : null;
}
export function collapseLivePhotoComponents(assets: EagleAssetListItem[], sources = assets) {
  const videos = new Set(
    sources.flatMap((asset) => (asset.livePhotoMotion ? [asset.livePhotoMotion.assetId] : [])),
  );
  return assets.filter((asset) => !videos.has(asset.id));
}
