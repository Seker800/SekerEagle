import {
  getEagleRenditionContentUrl,
  type EagleAssetListItem,
  type EaglePyramidDescriptor,
} from '../../lib/eagle-api';
import { resolveEagleMediaPath } from '../../lib/media-resolver';

const IMAGE_PYRAMID_DIMENSION_THRESHOLD = 4_096;
const IMAGE_PYRAMID_PIXEL_THRESHOLD = 16_000_000;

export function getEaglePreviewContentUrl(asset: EagleAssetListItem): string | null {
  const currentRenditions = asset.renditions.filter(
    (rendition) => rendition.revision === asset.mediaRevision,
  );
  const selected =
    currentRenditions.find(({ kind }) => kind === 'PREVIEW') ??
    currentRenditions.find(({ kind }) => kind === 'THUMBNAIL');
  return selected ? getEagleRenditionContentUrl(asset.id, selected.id, selected.kind) : null;
}

export function getEagleThumbnailSourceSet(asset: EagleAssetListItem) {
  const candidates = asset.renditions
    .filter(
      (rendition) =>
        rendition.kind === 'THUMBNAIL' &&
        rendition.revision === asset.mediaRevision &&
        rendition.width,
    )
    .sort((left, right) => left.width! - right.width!);
  const first = candidates[0];
  if (!first) return null;
  return {
    src: getEagleRenditionContentUrl(asset.id, first.id, first.kind),
    srcSet: candidates
      .map(
        (rendition) =>
          `${getEagleRenditionContentUrl(asset.id, rendition.id, rendition.kind)} ${rendition.width}w`,
      )
      .join(', '),
  };
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
