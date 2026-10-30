import type { EagleAsset, EagleAssetPage } from '../lib/eagle-api';
export function makeEagleAsset(overrides: Partial<EagleAsset> = {}): EagleAsset {
  return {
    id: 'a',
    originalName: 'a.jpg',
    displayName: 'a',
    mimeType: 'image/jpeg',
    format: 'jpeg',
    byteSize: 1,
    width: 1,
    height: 1,
    durationMs: null,
    lifecycleStatus: 'READY',
    mediaErrorCode: null,
    mediaRevision: 1,
    rowVersion: 1,
    rating: null,
    libraryAddedAt: '2026-10-30T00:00:00Z',
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    deletedAt: null,
    renditions: [],
    manualTags: [],
    annotation: null,
    aiTags: [],
    colorAnalysis: null,
    ...overrides,
  };
}
export const makeEaglePage = (ids: string[]): EagleAssetPage => ({
  items: ids.map((id) => makeEagleAsset({ id })),
  nextCursor: null,
  colorCoverage: null,
});
