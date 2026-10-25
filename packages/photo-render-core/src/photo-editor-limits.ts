export const MAX_PHOTO_PIXELS = 48_000_000;
export const MAX_PHOTO_EDGE = 16_384;
export function withinPhotoOutputBudget(width: number, height: number): boolean {
  return width * height <= MAX_PHOTO_PIXELS && Math.max(width, height) <= MAX_PHOTO_EDGE;
}
