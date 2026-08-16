import sharp from 'sharp';

export const MAX_EAGLE_IMAGE_INPUT_PIXELS = 50_000_000;

export function createEagleImageProcessor(input?: Buffer | string) {
  return input
    ? sharp(input, { limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS, failOn: 'warning' })
    : sharp({ limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS, failOn: 'warning' });
}
