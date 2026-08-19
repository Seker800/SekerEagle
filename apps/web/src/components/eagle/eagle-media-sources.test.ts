import { describe, expect, it } from 'vitest';
import type { EagleAssetListItem, EaglePyramidDescriptor } from '../../lib/eagle-api';
import {
  createEagleTileSource,
  createEaglePreviewTileSource,
  getEaglePreviewContentUrl,
  getEagleThumbnailSourceSet,
  needsEagleImagePyramid,
} from './eagle-media-sources';

const asset = {
  id: 'asset-1',
  mimeType: 'image/jpeg',
  mediaRevision: 3,
  renditions: [
    { id: 'thumb-1', kind: 'THUMBNAIL', revision: 3 },
    { id: 'preview-old', kind: 'PREVIEW', revision: 2 },
    { id: 'preview-1', kind: 'PREVIEW', revision: 3 },
  ],
} as EagleAssetListItem;

describe('Eagle media sources', () => {
  it('uses the current preview and never falls back to the original image', () => {
    expect(getEaglePreviewContentUrl(asset)).toBe('/api/eagle/assets/asset-1/renditions/preview-1');
    expect(getEaglePreviewContentUrl({ ...asset, renditions: [] })).toBeNull();
  });

  it('builds a bounded authenticated Deep Zoom tile source', () => {
    const descriptor: EaglePyramidDescriptor = {
      id: 'pyramid-1',
      width: 8_000,
      height: 6_000,
      tileSize: 512,
      overlap: 1,
      format: 'webp',
      maxLevel: 13,
      tileUrlTemplate: '/api/eagle/assets/asset-1/pyramids/pyramid-1/tiles/{level}/{x}/{y}',
    };
    const source = createEagleTileSource(descriptor);

    expect(source.getTileUrl(13, 4, 2)).toBe(
      '/api/eagle/assets/asset-1/pyramids/pyramid-1/tiles/13/4/2',
    );
    expect(source.maxLevel).toBe(13);
  });

  it('builds a single-image source for the same zoom viewer', () => {
    expect(createEaglePreviewTileSource('/api/eagle/assets/asset-1/renditions/preview-1')).toEqual({
      type: 'image',
      url: '/api/eagle/assets/asset-1/renditions/preview-1',
    });
  });

  it('only requests pyramids for images that can have one', () => {
    expect(needsEagleImagePyramid(1_200, 800)).toBe(false);
    expect(needsEagleImagePyramid(4_097, 1)).toBe(true);
    expect(needsEagleImagePyramid(4_000, 4_001)).toBe(true);
    expect(needsEagleImagePyramid(null, 8_000)).toBe(false);
  });

  it('builds responsive thumbnail candidates in ascending width order', () => {
    const responsiveAsset = {
      ...asset,
      renditions: [
        { id: 'large', kind: 'THUMBNAIL', revision: 3, width: 512 },
        { id: 'small', kind: 'THUMBNAIL', revision: 3, width: 256 },
      ],
    } as EagleAssetListItem;

    expect(getEagleThumbnailSourceSet(responsiveAsset)).toEqual({
      src: '/api/eagle/assets/asset-1/renditions/small',
      srcSet:
        '/api/eagle/assets/asset-1/renditions/small 256w, /api/eagle/assets/asset-1/renditions/large 512w',
    });
  });
});
