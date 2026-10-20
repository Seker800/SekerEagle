import { useMemo } from 'react';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import type { PreviewImage } from '../media/image-preview/useImagePreviewState';
import { getEagleLivePhotoContentUrl, getEaglePreviewContentUrl } from './eagle-media-sources';

/** Buttons and keyboard navigation share one filtered gallery order and the same boundaries. */
export function useEaglePreviewNavigation(
  assets: EagleAssetListItem[],
  image: PreviewImage | null,
  onChange: (image: PreviewImage) => void,
) {
  return useMemo(() => {
    const images = assets.filter(
      (asset) => asset.mimeType.startsWith('image/') && getEaglePreviewContentUrl(asset),
    );
    const index = images.findIndex((asset) => asset.id === image?.assetId);
    const navigate = (target: EagleAssetListItem | undefined) =>
      target
        ? () => {
            onChange({
              src: getEaglePreviewContentUrl(target)!,
              alt: target.displayName,
              assetId: target.id,
              motionSrc: getEagleLivePhotoContentUrl(target),
            });
          }
        : undefined;
    return index < 0
      ? undefined
      : {
          previous: navigate(images[index - 1]),
          next: navigate(images[index + 1]),
          position: { current: index + 1, total: images.length },
        };
  }, [assets, image?.assetId, onChange]);
}
