import { t } from '../../../i18n';

export type WatermarkCategory = 'photo' | 'standard' | 'frame' | 'creative';
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
    category: 'photo',
    style: 'strip',
    time: true,
    theme: true,
    reference: 'classic/17,20',
  },
  {
    id: 'photo-side',
    label: t('纵向参数栏'),
    category: 'photo',
    style: 'side',
    time: true,
    theme: true,
    reference: 'leica_cloud/89',
  },
  {
    id: 'standard-left',
    label: t('平面签名'),
    category: 'standard',
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
    category: 'standard',
    style: 'cornerGrid',
    time: true,
    theme: true,
    overlay: true,
    reference: 'leica_cloud/88',
  },
  {
    id: 'color-block',
    label: t('色块信息条'),
    category: 'standard',
    style: 'colorBlock',
    time: true,
    theme: false,
    overlay: true,
    reference: 'tag/9',
  },
  {
    id: 'frame-minimal',
    label: t('居中留白'),
    category: 'frame',
    style: 'frame',
    time: true,
    theme: true,
    reference: 'classic/18,leica_cloud/90',
  },
  {
    id: 'header-footer',
    label: t('上下分区'),
    category: 'frame',
    style: 'headerFooter',
    time: true,
    theme: true,
    reference: 'tag/11',
  },
  {
    id: 'editorial-panel',
    label: t('左侧题签'),
    category: 'creative',
    style: 'editorial',
    time: true,
    theme: true,
    reference: 'classic/22',
  },
];
export const WATERMARK_CATEGORIES: readonly { id: WatermarkCategory; label: string }[] = [
  { id: 'photo', label: t('摄影') },
  { id: 'standard', label: t('叠印') },
  { id: 'frame', label: t('留白') },
  { id: 'creative', label: t('侧版') },
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
    strip: [0, 0, 0.12, 0],
    side: [0, 0.11, 0, 0],
    overlay: [0, 0, 0, 0],
    cornerGrid: [0, 0, 0, 0],
    colorBlock: [0, 0, 0, 0],
    frame: [0.055, 0.055, 0.2, 0.055],
    headerFooter: [0.12, 0.03, 0.15, 0.03],
    editorial: [0.04, 0.04, 0.04, 0.32],
  };
  const [top, right, bottom, left] = geometry[template.style].map((value) =>
    Math.round(value * width),
  );
  const outputWidth = Math.max(1, width + left + right);
  const outputHeight = Math.max(
    1,
    height + top + bottom,
    template.style === 'editorial' ? Math.round(width * 0.55) : 0,
  );
  const x = left,
    y = top + Math.floor((outputHeight - height - top - bottom) / 2);
  return {
    width: outputWidth,
    height: outputHeight,
    x,
    y,
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
