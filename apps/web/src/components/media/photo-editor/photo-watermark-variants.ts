import {
  DEFAULT_PHOTO_EDITS,
  WATERMARK_VARIANT_FIELDS,
  type PhotoEdits,
  type WatermarkVariant,
} from '@sekereagle/library-core';
import { findWatermark, type WatermarkTemplate } from './photo-watermark-model';

/** Freeze only the watermark-specific part of the active template. */
export function activeWatermarkVariant(edits: PhotoEdits): WatermarkVariant {
  return Object.fromEntries(
    WATERMARK_VARIANT_FIELDS.map((key) => [key, edits[key]]),
  ) as WatermarkVariant;
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

/**
 * Each template keeps its own appearance and text settings. Switching saves the
 * active template first, then restores that template's last state or its defaults.
 */
export function selectWatermarkTemplate(edits: PhotoEdits, id: string): Partial<PhotoEdits> {
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
  const next = { ...defaultVariant(target), ...(variants[target.id] ?? {}) };
  if (!target.theme) next.watermarkTheme = 'black';
  else if (target.overlay && next.watermarkTheme === 'frosted') next.watermarkTheme = 'white';
  next.watermarkShowTime = target.time ? next.watermarkShowTime : false;
  return { watermarkVariants: variants, watermark: target.id, ...next };
}
