import {
  getEagleRenditionContentUrl,
  type EagleAssetListItem,
  type EaglePyramidDescriptor,
} from '../../lib/eagle-api';

export function getEaglePreviewContentUrl(asset: EagleAssetListItem): string | null {
  const currentRenditions = asset.renditions.filter(
    (rendition) => rendition.revision === asset.mediaRevision,
  );
  const selected =
    currentRenditions.find(({ kind }) => kind === 'PREVIEW') ??
    currentRenditions.find(({ kind }) => kind === 'THUMBNAIL');
  return selected ? getEagleRenditionContentUrl(asset.id, selected.id) : null;
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
      return descriptor.tileUrlTemplate
        .replace('{level}', String(level))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
    },
  };
}
