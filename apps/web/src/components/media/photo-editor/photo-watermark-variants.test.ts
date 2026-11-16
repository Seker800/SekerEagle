import { describe, expect, it } from 'vitest';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
import {
  applyWatermarkPreset,
  selectWatermarkTemplate,
  watermarkPresetFromEdits,
} from './photo-watermark-variants';

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

it('remembers a changed setting for every template through the off state', async () => {
  const { WATERMARK_TEMPLATES } = await import('./photo-watermark-model');
  for (const template of WATERMARK_TEMPLATES) {
    const selected = {
      ...DEFAULT_PHOTO_EDITS,
      watermark: 'none',
      watermarkVariants: {},
      ...selectWatermarkTemplate({ ...DEFAULT_PHOTO_EDITS, watermarkVariants: {} }, template.id),
    };
    const changed = {
      ...selected,
      watermarkShowParameters: false,
      watermarkShowWebsite: false,
      watermarkWebsite: `example.com/${template.id}`,
    };
    const off = {
      ...changed,
      ...selectWatermarkTemplate(changed, 'none'),
    };
    const restored = {
      ...off,
      ...selectWatermarkTemplate(off, template.id),
    };
    expect(restored.watermark, template.id).toBe(template.id);
    expect(restored.watermarkShowParameters, template.id).toBe(false);
    expect(restored.watermarkShowWebsite, template.id).toBe(false);
    expect(restored.watermarkWebsite, template.id).toBe(`example.com/${template.id}`);
  }
});

describe('cross-photo watermark presets', () => {
  const presets = {
    'photo-side': {
      watermarkAlign: 'left' as const,
      watermarkTheme: 'black' as const,
      watermarkCameraColor: 'black' as const,
      watermarkTimeColor: 'black' as const,
      watermarkCamera: 'OLD CAMERA',
      watermarkParameters: 'OLD PARAMETERS',
      watermarkCapturedAt: '2000.01.01',
      watermarkWebsite: 'preset.example',
      watermarkShowWebsite: false,
      watermarkShowTime: false,
      watermarkShowParameters: false,
    },
  };

  it('uses a saved preset when a template has no photo-specific state', () => {
    const side = { ...strip, ...selectWatermarkTemplate(strip, 'photo-side', presets) };
    expect(side.watermark).toBe('photo-side');
    expect(side.watermarkTheme).toBe('black');
    expect(side.watermarkCameraColor).toBe('black');
    expect(side.watermarkWebsite).toBe('preset.example');
    expect(side.watermarkShowWebsite).toBe(false);
    expect(side.watermarkShowParameters).toBe(false);
    expect(side.watermarkCamera).toBeNull();
    expect(side.watermarkParameters).toBeNull();
    expect(side.watermarkCapturedAt).toBeNull();
  });

  it('keeps photo-specific state ahead of a global preset', () => {
    const edited = {
      ...strip,
      ...selectWatermarkTemplate(strip, 'photo-side', presets),
      watermarkTheme: 'white' as const,
      watermarkCamera: 'THIS PHOTO',
      watermarkVariants: {
        'photo-side': {
          ...presets['photo-side'],
          watermarkTheme: 'white' as const,
          watermarkCamera: 'THIS PHOTO',
        },
      },
    };
    const restored = { ...edited, ...selectWatermarkTemplate(edited, 'photo-side', presets) };
    expect(restored.watermarkTheme).toBe('white');
    expect(restored.watermarkCamera).toBe('THIS PHOTO');
  });

  it('applies the initial template preset and never carries photo text into the preset', () => {
    const initial = applyWatermarkPreset(
      { ...DEFAULT_PHOTO_EDITS, watermark: 'photo-side', watermarkCamera: 'CURRENT PHOTO' },
      presets,
    );
    expect(initial.watermarkTheme).toBe('black');
    expect(initial.watermarkCamera).toBeNull();
    expect(initial.watermarkShowWebsite).toBe(false);
    const saved = watermarkPresetFromEdits({
      ...strip,
      watermarkCamera: 'CURRENT PHOTO',
      watermarkParameters: 'CURRENT PARAMETERS',
      watermarkCapturedAt: '2026.11.16',
    });
    expect(saved.watermarkCamera).toBeNull();
    expect(saved.watermarkParameters).toBeNull();
    expect(saved.watermarkCapturedAt).toBeNull();
  });
});
