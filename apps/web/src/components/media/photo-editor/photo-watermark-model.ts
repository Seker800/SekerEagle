import { t } from '../../../i18n';

export type WatermarkCategory = 'photo' | 'standard' | 'frame' | 'film' | 'creative';
export type WatermarkStyle =
  | 'strip'
  | 'editorial'
  | 'overlay'
  | 'gallery'
  | 'instant'
  | 'film'
  | 'cinema'
  | 'postcard'
  | 'blueprint';
export type WatermarkAlignment = 'left' | 'center' | 'right';
export interface WatermarkTemplate {
  id: string;
  label: string;
  category: WatermarkCategory;
  style: WatermarkStyle;
  time: boolean;
  theme: boolean;
  alignment?: boolean;
}

// One entry per composition. Alignment and theme are controls, never duplicate templates.
export const WATERMARK_TEMPLATES: readonly WatermarkTemplate[] = [
  {
    id: 'photo-strip',
    label: t('摄影信息条'),
    category: 'photo',
    style: 'strip',
    time: true,
    theme: true,
    alignment: true,
  },
  {
    id: 'photo-side',
    label: t('杂志侧栏'),
    category: 'photo',
    style: 'editorial',
    time: true,
    theme: true,
  },
  {
    id: 'standard-left',
    label: t('平面签名'),
    category: 'standard',
    style: 'overlay',
    time: true,
    theme: true,
    alignment: true,
  },
  {
    id: 'frame-minimal',
    label: t('展签相框'),
    category: 'frame',
    style: 'gallery',
    time: true,
    theme: true,
  },
  {
    id: 'instant-print',
    label: t('拍立得'),
    category: 'frame',
    style: 'instant',
    time: true,
    theme: true,
  },
  {
    id: 'film-perforated',
    label: t('胶片齿孔'),
    category: 'film',
    style: 'film',
    time: true,
    theme: false,
  },
  {
    id: 'cinema-bars',
    label: t('电影画幅'),
    category: 'film',
    style: 'cinema',
    time: true,
    theme: false,
  },
  {
    id: 'postcard',
    label: t('明信片'),
    category: 'creative',
    style: 'postcard',
    time: true,
    theme: false,
  },
  {
    id: 'blueprint',
    label: t('技术图纸'),
    category: 'creative',
    style: 'blueprint',
    time: true,
    theme: false,
  },
];
export const WATERMARK_CATEGORIES: readonly { id: WatermarkCategory; label: string }[] = [
  { id: 'photo', label: t('摄影') },
  { id: 'standard', label: t('签名') },
  { id: 'frame', label: t('相框') },
  { id: 'film', label: t('胶片') },
  { id: 'creative', label: t('创意') },
];
export interface PhotoMetadata {
  camera?: string;
  parameters?: string;
  capturedAt?: string;
}

const LEGACY_WATERMARKS: Record<string, string> = {
  'photo-poster': 'instant-print',
  'standard-right': 'standard-left',
  'classic-strip': 'photo-strip',
  'classic-frame': 'frame-minimal',
  'film-dark': 'film-perforated',
  'sport-tag': 'standard-left',
  'sport-rail': 'photo-side',
  'frame-poster': 'instant-print',
};
export function findWatermark(id: string): WatermarkTemplate | undefined {
  return WATERMARK_TEMPLATES.find((template) => template.id === (LEGACY_WATERMARKS[id] ?? id));
}
export function watermarkAlignment(id: string, alignment: WatermarkAlignment): WatermarkAlignment {
  return id === 'standard-right' ? 'right' : alignment;
}

/** All borders are outside the original photo; never resize or cover pixels to fit a frame. */
export function photoWatermarkLayout(width: number, height: number, template: WatermarkTemplate) {
  const geometry: Record<WatermarkStyle, readonly [number, number, number, number]> = {
    // top / right / bottom / left, relative to photo width
    strip: [0.025, 0.025, 0.15, 0.025],
    editorial: [0.04, 0.4, 0.04, 0.04],
    overlay: [0, 0, 0, 0],
    gallery: [0.12, 0.12, 0.28, 0.12],
    instant: [0.055, 0.055, 0.34, 0.055],
    film: [0.065, 0.04, 0.12, 0.04],
    cinema: [0.11, 0, 0.14, 0],
    postcard: [0.055, 0.52, 0.055, 0.055],
    blueprint: [0.095, 0.075, 0.095, 0.075],
  };
  const [top, right, bottom, left] = geometry[template.style].map((value) =>
    Math.round(value * width),
  );
  const outputWidth = Math.max(1, width + left + right);
  const outputHeight = Math.max(
    1,
    height + top + bottom,
    template.style === 'editorial' || template.style === 'postcard' ? Math.round(width * 0.6) : 0,
  );
  const x = left,
    y = top + Math.floor((outputHeight - height - top - bottom) / 2);
  const side = template.style === 'editorial' || template.style === 'postcard';
  return {
    width: outputWidth,
    height: outputHeight,
    x,
    y,
    photoWidth: width,
    photoHeight: height,
    caption: side ? right : bottom,
    panel: side
      ? { x: x + width, y: top, width: right, height: outputHeight - top - bottom }
      : { x, y: y + height, width, height: outputHeight - y - height },
  };
}
