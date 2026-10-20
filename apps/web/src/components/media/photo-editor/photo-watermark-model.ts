import { t } from '../../../i18n';

export type WatermarkCategory = 'landscape' | 'portrait' | 'universal';
export type WatermarkStyle =
  | 'strip'
  | 'side'
  | 'overlay'
  | 'frame'
  | 'headerFooter'
  | 'colorBlock'
  | 'cornerGrid'
  | 'editorial';
export type WatermarkAlignment = 'left' | 'center' | 'right';
export interface WatermarkTemplate {
  id: string;
  label: string;
  category: WatermarkCategory;
  style: WatermarkStyle;
  time: boolean;
  theme: boolean;
  alignment?: boolean;
  overlay?: boolean;
  reference: string;
}

// Reduced from the reference project's real layouts; no OEM logos or extracted assets.
// A theme or alignment change is a setting, not another template.
export const WATERMARK_TEMPLATES: readonly WatermarkTemplate[] = [
  {
    id: 'photo-strip',
    label: t('摄影信息条'),
    category: 'landscape',
    style: 'strip',
    time: true,
    theme: true,
    reference: 'classic/17,20',
  },
  {
    id: 'photo-side',
    label: t('纵向参数栏'),
    category: 'portrait',
    style: 'side',
    time: true,
    theme: true,
    reference: 'leica_cloud/89',
  },
  {
    id: 'standard-left',
    label: t('简洁叠印'),
    category: 'universal',
    style: 'overlay',
    time: true,
    theme: true,
    alignment: true,
    overlay: true,
    reference: 'standard/6,7,8',
  },
  {
    id: 'corner-grid',
    label: t('四角信息'),
    category: 'universal',
    style: 'cornerGrid',
    time: true,
    theme: true,
    overlay: true,
    reference: 'leica_cloud/88',
  },
  {
    id: 'color-block',
    label: t('色块信息条'),
    category: 'landscape',
    style: 'colorBlock',
    time: true,
    theme: false,
    overlay: true,
    reference: 'tag/9',
  },
  {
    id: 'frame-minimal',
    label: t('居中留白'),
    category: 'universal',
    style: 'frame',
    time: true,
    theme: true,
    reference: 'classic/18,leica_cloud/90',
  },
  {
    id: 'header-footer',
    label: t('上下分区'),
    category: 'landscape',
    style: 'headerFooter',
    time: true,
    theme: true,
    reference: 'tag/11',
  },
  {
    id: 'editorial-panel',
    label: t('侧栏信息'),
    category: 'portrait',
    style: 'editorial',
    time: true,
    theme: true,
    reference: 'classic/22',
  },
];
export const WATERMARK_CATEGORIES: readonly { id: WatermarkCategory; label: string }[] = [
  { id: 'landscape', label: t('适合横图') },
  { id: 'portrait', label: t('适合竖图') },
  { id: 'universal', label: t('横竖通用') },
];
export interface PhotoMetadata {
  camera?: string;
  parameters?: string;
  capturedAt?: string;
}

const LEGACY_WATERMARKS: Record<string, string> = {
  'photo-poster': 'frame-minimal',
  'standard-right': 'standard-left',
  'classic-strip': 'photo-strip',
  'classic-frame': 'frame-minimal',
  'film-dark': 'header-footer',
  'film-perforated': 'header-footer',
  'sport-tag': 'standard-left',
  'sport-rail': 'photo-side',
  'frame-poster': 'frame-minimal',
  'instant-print': 'frame-minimal',
  'cinema-bars': 'header-footer',
  postcard: 'editorial-panel',
  blueprint: 'corner-grid',
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
    strip: [0, 0, 0.09, 0],
    side: [0, 0.065, 0, 0],
    overlay: [0, 0, 0, 0],
    cornerGrid: [0, 0, 0, 0],
    colorBlock: [0, 0, 0, 0],
    frame: [0.05, 0.05, 0.16, 0.05],
    headerFooter: [0.075, 0, 0.105, 0],
    editorial: [0.035, 0.035, 0.035, 0.28],
  };
  const edges = geometry[template.style];
  const vertical = edges[0] + edges[2];
  // Base every template on the photo short edge, preserving the existing portrait scale.
  // Outside top + bottom borders occupy at most 20% of the finished image height.
  const referenceWidth = Math.min(
    width,
    height,
    vertical > 0 ? (height * 0.25) / vertical : Infinity,
  );
  const [top, right, bottom, left] = edges.map((value) => Math.round(value * referenceWidth));
  const outputWidth = Math.max(1, width + left + right);
  const outputHeight = Math.max(1, height + top + bottom);
  const x = left,
    y = top + Math.floor((outputHeight - height - top - bottom) / 2);
  return {
    width: outputWidth,
    height: outputHeight,
    x,
    y,
    referenceWidth,
    photoWidth: width,
    photoHeight: height,
    caption: template.style === 'side' ? right : template.style === 'editorial' ? left : bottom,
    panel:
      template.style === 'side'
        ? { x: x + width, y: 0, width: right, height: outputHeight }
        : template.style === 'editorial'
          ? { x: 0, y: top, width: left, height: outputHeight - top - bottom }
          : { x, y: y + height, width, height: outputHeight - y - height },
  };
}
