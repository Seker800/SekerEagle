import {
  DEFAULT_PHOTO_EDITS,
  WATERMARK_VARIANT_FIELDS,
  type PhotoEdits,
  type WatermarkVariant,
} from '@sekereagle/library-core';
import { findWatermark, type WatermarkTemplate } from './photo-watermark-model';

export type WatermarkPresets = Record<string, WatermarkVariant>;

/** Freeze only the watermark-specific part of the active template. */
export function activeWatermarkVariant(edits: PhotoEdits): WatermarkVariant {
  return Object.fromEntries(
    WATERMARK_VARIANT_FIELDS.map((key) => [key, edits[key]]),
  ) as WatermarkVariant;
}

/** Photo-specific text is excluded from cross-photo presets. */
export function watermarkPresetFromEdits(edits: PhotoEdits): WatermarkVariant {
  return {
    ...activeWatermarkVariant(edits),
    watermarkCamera: null,
    watermarkParameters: null,
    watermarkCapturedAt: null,
  };
}

function defaultVariant(template: WatermarkTemplate): WatermarkVariant {
  return {
    watermarkAlign: 'left',
    watermarkTheme: template.theme ? 'white' : 'black',
    watermarkCameraColor: 'white',
    watermarkTimeColor: 'white',
    watermarkCamera: null,
    watermarkParameters: null,
    watermarkCapturedAt: null,
    watermarkWebsite: DEFAULT_PHOTO_EDITS.watermarkWebsite,
    watermarkShowWebsite: true,
    watermarkShowTime: template.time,
    watermarkShowParameters: true,
  };
}

function normalizedVariant(
  template: WatermarkTemplate,
  variant: WatermarkVariant,
): WatermarkVariant {
  const next = { ...defaultVariant(template), ...variant };
  if (!template.theme) next.watermarkTheme = 'black';
  else if (template.overlay && next.watermarkTheme === 'frosted') next.watermarkTheme = 'white';
  next.watermarkShowTime = template.time ? next.watermarkShowTime : false;
  return next;
}

function presetVariant(template: WatermarkTemplate, preset: WatermarkVariant): WatermarkVariant {
  return {
    ...normalizedVariant(template, preset),
    watermarkCamera: null,
    watermarkParameters: null,
    watermarkCapturedAt: null,
  };
}

/** Apply a saved cross-photo preset to the photo's current template. */
export function applyWatermarkPreset(edits: PhotoEdits, presets: WatermarkPresets): PhotoEdits {
  const template = findWatermark(edits.watermark);
  const preset = template && presets[template.id];
  if (!template || !preset) return edits;
  return { ...edits, ...presetVariant(template, preset) };
}

/**
 * Each template keeps its own appearance and text settings. Switching saves the
 * active template first, then restores that template's photo state, its saved
 * cross-photo preset, or the template defaults.
 */
export function selectWatermarkTemplate(
  edits: PhotoEdits,
  id: string,
  presets: WatermarkPresets = {},
): Partial<PhotoEdits> {
  const current = findWatermark(edits.watermark);
  const target = findWatermark(id);
  if (id === 'none') {
    if (!current) return { watermark: 'none' };
    return {
      watermark: 'none',
      watermarkVariants: {
        ...edits.watermarkVariants,
        [current.id]: activeWatermarkVariant(edits),
      },
    };
  }
  if (!target) return { watermark: id };
  if (current?.id === target.id) return { watermark: target.id };
  const variants = { ...edits.watermarkVariants };
  if (current) variants[current.id] = activeWatermarkVariant(edits);
  const saved = variants[target.id];
  const preset = presets[target.id];
  const next = saved
    ? normalizedVariant(target, saved)
    : preset
      ? presetVariant(target, preset)
      : defaultVariant(target);
  return { watermarkVariants: variants, watermark: target.id, ...next };
}
