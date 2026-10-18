import { CAMERA_MAX_IMAGE_PIXELS } from '@sekereagle/library-core';
import sharp from 'sharp';

export const MAX_EAGLE_IMAGE_INPUT_PIXELS = CAMERA_MAX_IMAGE_PIXELS;

export function createEagleImageProcessor(input?: Buffer | string) {
  return input
    ? sharp(input, { limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS, failOn: 'warning' })
    : sharp({ limitInputPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS, failOn: 'warning' });
}
