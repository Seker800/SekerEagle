import * as photon from '@silvia-odwyer/photon/photon_rs.js';
import type { PhotoEdits } from './photo-editor-model';
import { applyPhotoTone, MIDTONE_GAMMA_STOPS } from './photo-editor-tone';
import { applyExtendedTone } from './photo-editor-extended-tone';
import { applyPhotoDetail } from './photo-editor-detail';

import { applyPhotoColorMixer } from './photo-editor-color-mixer';
import { applyPhotoDenoise } from './photo-editor-denoise';
import { applyPhotoDehaze } from './photo-editor-dehaze';

export function processPhotoPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  edits: PhotoEdits,
): Uint8Array {
  let image: photon.PhotonImage | undefined;
  try {
    const cleaned = applyPhotoDehaze(
      applyPhotoDenoise(pixels, width, height, edits),
      width,
      height,
      edits,
    );
    const adjusted = applyPhotoColorMixer(
      applyExtendedTone(applyPhotoTone(cleaned, edits), edits),
      edits,
    );
    if (!edits.gamma && (edits.filter === 'original' || edits.filterStrength === 0))
      return applyPhotoDetail(adjusted, width, height, edits);
    image = new photon.PhotonImage(adjusted, width, height);
    if (edits.gamma) {
      const gamma = 2 ** ((edits.gamma / 100) * MIDTONE_GAMMA_STOPS);
      photon.gamma_correction(image, gamma, gamma, gamma);
    }
    const beforeFilter = image.get_raw_pixels();
    if (edits.filter !== 'original') {
      if (edits.filter === 'monochrome') photon.grayscale(image);
      else photon.filter(image, edits.filter);
    }
    const output = image.get_raw_pixels();
    if (edits.filter !== 'original' && edits.filterStrength < 100) {
      const amount = edits.filterStrength / 100;
      for (let i = 0; i < output.length; i += 4) {
        // Standard linear interpolation of the preset result; preserve source alpha.
        for (let channel = 0; channel < 3; channel++) {
          output[i + channel] = Math.round(
            beforeFilter[i + channel] * (1 - amount) + output[i + channel] * amount,
          );
        }
        output[i + 3] = beforeFilter[i + 3];
      }
    }
    return applyPhotoDetail(output, width, height, edits);
  } finally {
    image?.free();
  }
}
