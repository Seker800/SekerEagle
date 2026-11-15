import { describe, expect, it } from 'vitest';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
import { selectWatermarkTemplate } from './photo-watermark-variants';

const strip = {
  ...DEFAULT_PHOTO_EDITS,
  watermark: 'photo-strip',
  watermarkTheme: 'frosted' as const,
  watermarkShowParameters: false,
  watermarkCamera: 'NIKON Z5',
  watermarkVariants: {},
};

describe('per-template watermark memory', () => {
  it('does not carry one template settings into another, and restores each on return', () => {
    const side = { ...strip, ...selectWatermarkTemplate(strip, 'photo-side') };
    expect(side.watermark).toBe('photo-side');
    expect(side.watermarkTheme).toBe('white');
    expect(side.watermarkShowParameters).toBe(true);
    expect(side.watermarkCamera).toBeNull();

    const editedSide = {
      ...side,
      watermarkTheme: 'black' as const,
      watermarkCameraColor: 'black' as const,
      watermarkShowParameters: false,
      watermarkCamera: 'FUJIFILM X-T5',
    };
    const backToStrip = { ...editedSide, ...selectWatermarkTemplate(editedSide, 'photo-strip') };
    expect(backToStrip.watermark).toBe('photo-strip');
    expect(backToStrip.watermarkTheme).toBe('frosted');
    expect(backToStrip.watermarkShowParameters).toBe(false);
    expect(backToStrip.watermarkCamera).toBe('NIKON Z5');

    const sideAgain = { ...backToStrip, ...selectWatermarkTemplate(backToStrip, 'photo-side') };
    expect(sideAgain.watermarkTheme).toBe('black');
    expect(sideAgain.watermarkCameraColor).toBe('black');
    expect(sideAgain.watermarkShowParameters).toBe(false);
    expect(sideAgain.watermarkCamera).toBe('FUJIFILM X-T5');
  });

  it('keeps the active template state while watermark is off', () => {
    const none = { ...strip, ...selectWatermarkTemplate(strip, 'none') };
    expect(none.watermark).toBe('none');
    const restored = { ...none, ...selectWatermarkTemplate(none, 'photo-strip') };
    expect(restored.watermarkTheme).toBe('frosted');
    expect(restored.watermarkCamera).toBe('NIKON Z5');
  });

  it('normalizes overlay and non-theme templates', () => {
    const overlay = { ...strip, ...selectWatermarkTemplate(strip, 'standard-left') };
    expect(overlay.watermarkTheme).toBe('white');
    const nonTheme = { ...overlay, ...selectWatermarkTemplate(overlay, 'color-block') };
    expect(nonTheme.watermarkTheme).toBe('black');
  });
});
