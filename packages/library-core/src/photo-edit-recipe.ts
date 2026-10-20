import { DEFAULT_ADVANCED_EDITS, type AdvancedKey } from './photo-edit-advanced';
export type PhotoFilter = 'original' | 'vintage' | 'oceanic' | 'monochrome' | `lut:${string}`;
// Each pair shares one visual preset, with an explicit landscape / portrait choice.
export const CROP_RATIO_PAIRS = [
  ['1:1', '1:1'],
  ['4:3', '3:4'],
  ['3:2', '2:3'],
  ['5:4', '4:5'],
  ['16:9', '9:16'],
  ['21:9', '9:21'],
] as const;
export const FIXED_CROP_RATIOS = ['original', ...new Set(CROP_RATIO_PAIRS.flat())] as const;
export type CropRatio = 'free' | (typeof FIXED_CROP_RATIOS)[number];
export interface PhotoEdits extends Record<AdvancedKey, number> {
  dehaze: number;
  luminanceNoise: number;
  colorNoise: number;
  exposure: number;
  contrast: number;
  saturation: number;
  gamma: number;
  brightness: number;
  lightPerception: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  temperature: number;
  tint: number;
  fade: number;
  sharpen: number;
  clarity: number;
  grain: number;
  vignette: number;
  watermark: string;
  watermarkAlign: 'left' | 'center' | 'right';
  watermarkTheme: 'white' | 'black' | 'frosted';
  watermarkCamera: string | null;
  watermarkParameters: string | null;
  watermarkCapturedAt: string | null;
  watermarkWebsite: string;
  watermarkShowWebsite: boolean;
  watermarkShowTime: boolean;
  watermarkShowParameters: boolean;
  filter: PhotoFilter;
  filterStrength: number;
  rotation: number;
  flip: boolean;
  cropRatio: CropRatio;
  cropZoom: number;
  cropAspect: number;
  cropX: number;
  cropY: number;
}
export const DEFAULT_PHOTO_EDITS: PhotoEdits = {
  ...DEFAULT_ADVANCED_EDITS,
  dehaze: 0,
  luminanceNoise: 0,
  colorNoise: 0,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
  brightness: 0,
  lightPerception: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  sharpen: 0,
  clarity: 0,
  grain: 0,
  vignette: 0,
  watermark: 'none',
  watermarkAlign: 'left',
  watermarkTheme: 'white',
  watermarkCamera: null,
  watermarkParameters: null,
  watermarkCapturedAt: null,
  watermarkWebsite: 'WWW.SEKER.WANG',
  watermarkShowWebsite: true,
  watermarkShowTime: true,
  watermarkShowParameters: true,
  filter: 'original',
  filterStrength: 100,
  rotation: 0,
  flip: false,
  cropRatio: 'free',
  cropZoom: 1,
  cropAspect: 0,
  cropX: 0.5,
  cropY: 0.5,
};

export interface PhotoEditRecipe {
  version: 1;
  edits: PhotoEdits;
}
export interface PhotoEditParts {
  adjustments: boolean;
  filter: boolean;
  watermark: boolean;
  crop: boolean;
}
export function readPhotoEditRecipe(value: unknown): PhotoEditRecipe {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_EDIT_RECIPE');
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    Object.keys(record).some((key) => key !== 'version' && key !== 'edits') ||
    !record.edits ||
    typeof record.edits !== 'object' ||
    Array.isArray(record.edits)
  )
    throw new Error('INVALID_EDIT_RECIPE');
  const input = record.edits as Record<string, unknown>;
  const edits = { ...DEFAULT_PHOTO_EDITS };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_PHOTO_EDITS, key)) throw new Error('INVALID_EDIT_RECIPE');
    const initial = DEFAULT_PHOTO_EDITS[key as keyof PhotoEdits];
    if (typeof initial === 'number') {
      const [min, max] =
        key === 'cropZoom'
          ? [1, 100]
          : key === 'cropAspect'
            ? [0, 100]
            : key === 'cropX' || key === 'cropY'
              ? [0, 1]
              : key === 'rotation'
                ? [0, 270]
                : key === 'filterStrength'
                  ? [0, 100]
                  : [-100, 100];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (key === 'rotation' && value % 90 !== 0)
      )
        throw new Error('INVALID_EDIT_RECIPE');
    } else if (initial === null) {
      if (value !== null && (typeof value !== 'string' || value.length > 2000))
        throw new Error('INVALID_EDIT_RECIPE');
    } else if (
      typeof value !== typeof initial ||
      (typeof value === 'string' && value.length > 2000)
    )
      throw new Error('INVALID_EDIT_RECIPE');
    Object.assign(edits, { [key]: value });
  }
  if (
    !['left', 'center', 'right'].includes(edits.watermarkAlign) ||
    !['white', 'black', 'frosted'].includes(edits.watermarkTheme) ||
    !['free', ...FIXED_CROP_RATIOS].includes(edits.cropRatio) ||
    !/^(original|vintage|oceanic|monochrome|lut:[\w-]+)$/.test(edits.filter)
  )
    throw new Error('INVALID_EDIT_RECIPE');
  return { version: 1, edits };
}
const CROP_KEYS = new Set([
  'rotation',
  'flip',
  'cropRatio',
  'cropZoom',
  'cropAspect',
  'cropX',
  'cropY',
]);
export function selectPhotoEditParts(
  source: PhotoEdits,
  target: PhotoEdits,
  parts: PhotoEditParts,
): PhotoEdits {
  const edits = { ...target };
  for (const key of Object.keys(DEFAULT_PHOTO_EDITS) as (keyof PhotoEdits)[]) {
    const enabled = CROP_KEYS.has(key)
      ? parts.crop
      : key.startsWith('watermark')
        ? parts.watermark
        : key === 'filter' || key === 'filterStrength'
          ? parts.filter
          : parts.adjustments;
    if (enabled) Object.assign(edits, { [key]: source[key] });
  }
  if (parts.watermark)
    Object.assign(edits, {
      watermarkCamera: null,
      watermarkParameters: null,
      watermarkCapturedAt: null,
    });
  return edits;
}
