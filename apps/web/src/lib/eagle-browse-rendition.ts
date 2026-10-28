import type { EagleAssetListItem, EagleRendition } from './eagle-api';

/** Current browsing media only; editing and motion derivatives have separate consumers. */
export function selectEagleBrowseRendition(asset: EagleAssetListItem): EagleRendition | undefined {
  const currentRenditions = asset.renditions.filter(
    (rendition) => rendition.revision === asset.mediaRevision,
  );
  return (
    currentRenditions.find(
      ({ kind, mimeType, variant }) =>
        variant !== 'edit' &&
        kind === 'PREVIEW' &&
        (!asset.mimeType.startsWith('image/') || !mimeType || mimeType.startsWith('image/')),
    ) ?? currentRenditions.find(({ kind }) => kind === 'THUMBNAIL')
  );
}
