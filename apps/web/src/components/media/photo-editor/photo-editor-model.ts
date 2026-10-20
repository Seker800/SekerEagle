import { DEFAULT_PHOTO_EDITS, type PhotoEdits } from '@sekereagle/library-core';
export {
  DEFAULT_PHOTO_EDITS,
  CROP_RATIO_PAIRS,
  FIXED_CROP_RATIOS,
  type PhotoEdits,
  type PhotoFilter,
  type CropRatio,
} from '@sekereagle/library-core';

/** Crop is measured in oriented source pixels; preview and export share this geometry. */
export function photoCrop(width: number, height: number, edits: PhotoEdits, rasterize = true) {
  const rotated = edits.rotation % 180 !== 0;
  const orientedWidth = rotated ? height : width;
  const orientedHeight = rotated ? width : height;
  const ratio =
    edits.cropRatio === 'original'
      ? orientedWidth / orientedHeight
      : edits.cropRatio === 'free'
        ? edits.cropAspect > 0
          ? edits.cropAspect
          : orientedWidth / orientedHeight
        : Number(edits.cropRatio.split(':')[0]) / Number(edits.cropRatio.split(':')[1]);
  const baseWidth =
    edits.cropRatio === 'original'
      ? orientedWidth
      : Math.min(orientedWidth, orientedHeight * ratio);
  const baseHeight =
    edits.cropRatio === 'original'
      ? orientedHeight
      : Math.min(orientedHeight, orientedWidth / ratio);
  const zoom = Number.isFinite(edits.cropZoom) ? Math.max(1, Math.min(16, edits.cropZoom)) : 1;
  const round = rasterize ? Math.round : (value: number) => value;
  const cropWidth = Math.max(1, round(baseWidth / zoom));
  const cropHeight = Math.max(1, round(baseHeight / zoom));
  return {
    orientedWidth,
    orientedHeight,
    x: round((orientedWidth - cropWidth) * Math.max(0, Math.min(1, edits.cropX))),
    y: round((orientedHeight - cropHeight) * Math.max(0, Math.min(1, edits.cropY))),
    width: Math.max(1, cropWidth),
    height: Math.max(1, cropHeight),
  };
}

export function hasPhotoEdits(edits: PhotoEdits): boolean {
  return Object.keys(DEFAULT_PHOTO_EDITS).some(
    (key) => edits[key as keyof PhotoEdits] !== DEFAULT_PHOTO_EDITS[key as keyof PhotoEdits],
  );
}
