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
  const baseWidth = rotated ? height : width;
  const baseHeight = rotated ? width : height;
  const straighten = Number.isFinite(edits.straighten)
    ? Math.max(-45, Math.min(45, edits.straighten))
    : 0;
  const radians = (Math.abs(straighten) * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  // Bounding box of the image after the optional straighten rotation.
  const orientedWidth = baseWidth * cos + baseHeight * sin;
  const orientedHeight = baseWidth * sin + baseHeight * cos;
  const ratio =
    edits.cropRatio === 'original'
      ? baseWidth / baseHeight
      : edits.cropRatio === 'free'
        ? edits.cropAspect > 0
          ? edits.cropAspect
          : baseWidth / baseHeight
        : Number(edits.cropRatio.split(':')[0]) / Number(edits.cropRatio.split(':')[1]);
  // Largest centered rectangle of the requested ratio that fits inside the rotated image.
  // At straighten 0 this equals the legacy crop base and keeps free crop movement across
  // the full oriented frame; a straightened image keeps every crop corner inside pixels.
  const fitHeight = Math.min(
    baseHeight,
    baseWidth / ratio,
    baseHeight / (ratio * sin + cos),
    baseWidth / (ratio * cos + sin),
  );
  const fitWidth = fitHeight * ratio;
  const movementX = straighten === 0 ? 0 : (orientedWidth - fitWidth) / 2;
  const movementY = straighten === 0 ? 0 : (orientedHeight - fitHeight) / 2;
  const movementWidth = straighten === 0 ? orientedWidth : fitWidth;
  const movementHeight = straighten === 0 ? orientedHeight : fitHeight;
  const zoom = Number.isFinite(edits.cropZoom) ? Math.max(1, Math.min(16, edits.cropZoom)) : 1;
  const round = rasterize ? Math.round : (value: number) => value;
  const cropWidth = Math.max(1, round(fitWidth / zoom));
  const cropHeight = Math.max(1, round(fitHeight / zoom));
  return {
    orientedWidth,
    orientedHeight,
    areaX: movementX,
    areaY: movementY,
    areaWidth: movementWidth,
    areaHeight: movementHeight,
    x: round(movementX + (movementWidth - cropWidth) * Math.max(0, Math.min(1, edits.cropX))),
    y: round(movementY + (movementHeight - cropHeight) * Math.max(0, Math.min(1, edits.cropY))),
    width: Math.max(1, cropWidth),
    height: Math.max(1, cropHeight),
  };
}

export function hasPhotoEdits(edits: PhotoEdits): boolean {
  return Object.keys(DEFAULT_PHOTO_EDITS).some(
    (key) => edits[key as keyof PhotoEdits] !== DEFAULT_PHOTO_EDITS[key as keyof PhotoEdits],
  );
}
