import { BadRequestException } from '@nestjs/common';
import type { Matrix3x3 } from 'sharp';
import { imageEditPixels, validateImageEdit, type ImageEdit } from '@sekereagle/library-core';
import { createEagleImageProcessor } from './eagle-image-processing-policy';

/** One bounded server decode; the browser never decodes an original. Output is lossless PNG. */
export async function renderImageEdit(input: Buffer, edit: ImageEdit): Promise<Buffer> {
  try {
    validateImageEdit(edit);
    const metadata = await createEagleImageProcessor(input).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error('Only still images can be edited');
    const width = metadata.autoOrient.width, height = metadata.autoOrient.height;
    const crop = imageEditPixels(edit, width, height);
    // Auto-orientation is its own pipeline so flips cannot be reordered across EXIF orientation.
    const oriented = await createEagleImageProcessor(input).autoOrient().keepExif().png().toBuffer();
    const saturation = edit.saturation;
    const weights = [.2126, .7152, .0722];
    const matrix = weights.map((_, row) => weights.map((weight, column) => weight * (1 - saturation) + (row === column ? saturation : 0))) as Matrix3x3;
    return await createEagleImageProcessor(oriented)
      .extract(crop).flip(edit.flipY).flop(edit.flipX).rotate(edit.rotation)
      .toColourspace('srgb').recomb(matrix)
      .linear(edit.brightness * edit.contrast, 128 * (1 - edit.contrast))
      .keepExif().withExifMerge({ IFD0: { Orientation: '1' } }).png().toBuffer();
  } catch {
    throw new BadRequestException('无法编辑该图片，请确认图片完整、为静态图片且编辑参数有效。');
  }
}
