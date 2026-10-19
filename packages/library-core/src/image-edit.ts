/** Crop coordinates refer to the EXIF-oriented source, before flips and quarter turns. */
export interface ImageEdit {
  crop: { x: number; y: number; width: number; height: number };
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
}

export function createImageEdit(): ImageEdit {
  return {
    crop: { x: 0, y: 0, width: 1, height: 1 },
    rotation: 0,
    flipX: false,
    flipY: false,
    brightness: 1,
    contrast: 1,
    saturation: 1,
  };
}

export function validateImageEdit(value: unknown): asserts value is ImageEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid image edit');
  const edit = value as ImageEdit;
  const keys = Object.keys(createImageEdit());
  if (
    Object.keys(edit).length !== keys.length ||
    Object.keys(edit).some((key) => !keys.includes(key))
  )
    throw new Error('Invalid image edit fields');
  if (
    ![0, 90, 180, 270].includes(edit.rotation) ||
    typeof edit.flipX !== 'boolean' ||
    typeof edit.flipY !== 'boolean'
  )
    throw new Error('Invalid image transform');
  for (const value of [edit.brightness, edit.contrast, edit.saturation]) {
    if (!Number.isFinite(value) || value < 0 || value > 2)
      throw new Error('Invalid image adjustment');
  }
  const crop = edit.crop;
  if (
    !crop ||
    typeof crop !== 'object' ||
    Object.keys(crop).sort().join(',') !== 'height,width,x,y'
  )
    throw new Error('Invalid crop');
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.00000001 ||
    crop.y + crop.height > 1.00000001
  )
    throw new Error('Crop is outside the image');
}

export function imageEditPixels(edit: ImageEdit, width: number, height: number) {
  validateImageEdit(edit);
  if (![width, height].every((value) => Number.isInteger(value) && value > 0))
    throw new Error('Invalid image size');
  const left = Math.min(width - 1, Math.round(edit.crop.x * width));
  const top = Math.min(height - 1, Math.round(edit.crop.y * height));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(edit.crop.width * width))),
    height: Math.max(1, Math.min(height - top, Math.round(edit.crop.height * height))),
  };
}

export function imageEditSize(edit: ImageEdit, width: number, height: number) {
  const crop = imageEditPixels(edit, width, height);
  return edit.rotation % 180
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
}

export const IMAGE_EDIT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/tiff',
] as const;
