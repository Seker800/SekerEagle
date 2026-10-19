import { DEFAULT_ADVANCED_EDITS, type AdvancedKey } from './photo-editor-advanced-model';
export type PhotoFilter = 'original' | 'vintage' | 'oceanic' | 'monochrome';
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
  watermarkTheme: 'white' | 'black';
  watermarkText: string;
  watermarkCamera: string | null;
  watermarkParameters: string | null;
  watermarkCapturedAt: string | null;
  watermarkWebsite: string;
  watermarkShowWebsite: boolean;
  watermarkShowTime: boolean;
  watermarkShowParameters: boolean;
  watermarkOpacity: number;
  watermarkScale: number;
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
  watermarkText: '',
  watermarkCamera: null,
  watermarkParameters: null,
  watermarkCapturedAt: null,
  watermarkWebsite: 'WWW.SEKER.WANG',
  watermarkShowWebsite: true,
  watermarkShowTime: true,
  watermarkShowParameters: true,
  watermarkOpacity: 90,
  watermarkScale: 100,
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

/** Crop is measured in oriented source pixels; preview and export share this geometry. */
export function photoCrop(width: number, height: number, edits: PhotoEdits, rasterize = true) {
  const rotated = edits.rotation % 180 !== 0;
  const orientedWidth = rotated ? height : width;
  const orientedHeight = rotated ? width : height;
  const ratio =
    edits.cropRatio === 'original'
      ? orientedWidth / orientedHeight
      : edits.cropRatio === 'free'
        ? edits.cropAspect > 0
          ? edits.cropAspect
          : orientedWidth / orientedHeight
        : Number(edits.cropRatio.split(':')[0]) / Number(edits.cropRatio.split(':')[1]);
  const baseWidth =
    edits.cropRatio === 'original'
      ? orientedWidth
      : Math.min(orientedWidth, orientedHeight * ratio);
  const baseHeight =
    edits.cropRatio === 'original'
      ? orientedHeight
      : Math.min(orientedHeight, orientedWidth / ratio);
  const zoom = Number.isFinite(edits.cropZoom) ? Math.max(1, Math.min(16, edits.cropZoom)) : 1;
  const round = rasterize ? Math.round : (value: number) => value;
  const cropWidth = Math.max(1, round(baseWidth / zoom));
  const cropHeight = Math.max(1, round(baseHeight / zoom));
  return {
    orientedWidth,
    orientedHeight,
    x: round((orientedWidth - cropWidth) * Math.max(0, Math.min(1, edits.cropX))),
    y: round((orientedHeight - cropHeight) * Math.max(0, Math.min(1, edits.cropY))),
    width: Math.max(1, cropWidth),
    height: Math.max(1, cropHeight),
  };
}

export function hasPhotoEdits(edits: PhotoEdits): boolean {
  return Object.keys(DEFAULT_PHOTO_EDITS).some(
    (key) => edits[key as keyof PhotoEdits] !== DEFAULT_PHOTO_EDITS[key as keyof PhotoEdits],
  );
}
