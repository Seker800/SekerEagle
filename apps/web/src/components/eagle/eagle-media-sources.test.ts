import { describe, expect, it } from 'vitest';
import type { EagleAssetListItem, EaglePyramidDescriptor } from '../../lib/eagle-api';
import {
  createEagleTileSource,
  createEaglePreviewTileSource,
  getEaglePreviewContentUrl,
  getEagleEditContentUrl,
  needsEagleImagePyramid,
} from './eagle-media-sources';
import type { SekerDesktopBridge } from '../../lib/media-resolver';

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

  it('routes Deep Zoom tiles through the desktop media capability when present', () => {
    const desktopAssetId = '00000000-0000-4000-8000-000000000001';
    const desktopPyramidId = '00000000-0000-4000-8000-000000000003';
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: (media) =>
        media.kind === 'TILE'
          ? `sekereagle-media://tile/${media.assetId}/${media.pyramidId}/${media.level}/${media.x}/${media.y}`
          : 'unexpected',
    };
    const source = createEagleTileSource({
      id: desktopPyramidId,
      width: 8_000,
      height: 6_000,
      tileSize: 512,
      overlap: 1,
      format: 'webp',
      maxLevel: 13,
      tileUrlTemplate: `/api/eagle/assets/${desktopAssetId}/pyramids/${desktopPyramidId}/tiles/{level}/{x}/{y}`,
    });

    expect(source.getTileUrl(13, 4, 2)).toBe(
      `sekereagle-media://tile/${desktopAssetId}/${desktopPyramidId}/13/4/2`,
    );
    delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
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
});

it('keeps the still preview when a motion rendition comes first and scopes paired playback URLs', async () => {
  const { getEagleLivePhotoContentUrl, collapseLivePhotoComponents } =
    await import('./eagle-media-sources');
  const still = {
    ...asset,
    libraryMode: 'PHOTO' as const,
    renditions: [
      { id: 'motion', kind: 'PREVIEW', revision: 3, mimeType: 'video/mp4' },
      ...asset.renditions,
    ],
  } as EagleAssetListItem;
  expect(getEaglePreviewContentUrl(still)).toContain('preview-1');
  expect(getEagleLivePhotoContentUrl(still)).toBe('/api/photos/assets/asset-1/renditions/motion');
  const paired = {
    ...asset,
    libraryMode: 'PHOTO' as const,
    livePhotoMotion: { assetId: 'movie', renditionId: 'play', revision: 1 },
  };
  expect(getEagleLivePhotoContentUrl(paired)).toBe('/api/photos/assets/movie/renditions/play');
  const movie = { ...asset, id: 'movie', mimeType: 'video/quicktime' };
  expect(collapseLivePhotoComponents([paired, movie])).toEqual([paired]);
  expect(collapseLivePhotoComponents([movie])).toEqual([movie]);
  expect(getEagleLivePhotoContentUrl(movie)).toBeNull();
});

it('edits camera RAW from a current dedicated derivative, never from the sensor original', () => {
  const raw = { ...asset, libraryMode: 'PHOTO', mimeType: 'image/x-adobe-dng', renditions: [
    { id: 'edit-old', kind: 'PREVIEW', variant: 'edit', revision: 2, mimeType: 'image/webp' },
    { id: 'edit-current', kind: 'PREVIEW', variant: 'edit', revision: 3, mimeType: 'image/webp' },
    { id: 'preview-current', kind: 'PREVIEW', variant: 'default', revision: 3, mimeType: 'image/webp' },
  ] } as EagleAssetListItem;
  expect(getEagleEditContentUrl(raw)).toBe('/api/photos/assets/asset-1/renditions/edit-current');
  expect(getEaglePreviewContentUrl(raw)).toBe('/api/photos/assets/asset-1/renditions/preview-current');
  expect(getEagleEditContentUrl({ ...raw, renditions: [] })).toBeNull();
  expect(getEagleEditContentUrl({ ...raw, renditions: raw.renditions.slice(0, 1) })).toBeNull();
  expect(getEagleEditContentUrl({ ...asset, lifecycleStatus: 'READY' })).toBe('/api/eagle/assets/asset-1/content');
  expect(getEagleEditContentUrl({ ...raw, lifecycleStatus: 'FAILED' })).toBeNull();
});
