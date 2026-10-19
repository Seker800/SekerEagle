import { t } from '../../../i18n';

export type WatermarkCategory = 'photo' | 'standard' | 'classic' | 'film' | 'sport' | 'frame';
export type WatermarkStyle = 'strip' | 'side' | 'overlay' | 'frame' | 'dark' | 'poster' | 'film';
export interface WatermarkTemplate {
  id: string;
  label: string;
  category: WatermarkCategory;
  style: WatermarkStyle;
  align: 'left' | 'center' | 'right';
  time: boolean;
  theme: boolean;
  accent?: boolean;
  wide?: boolean;
}

// Browser-native templates based on sekerwatermark's seven layout archetypes.
// No Android classes, OEM binaries, branded logos or extracted fonts are required.
export const WATERMARK_TEMPLATES: readonly WatermarkTemplate[] = [
  {
    id: 'photo-strip',
    label: t('摄影信息条'),
    category: 'photo',
    style: 'strip',
    align: 'left',
    time: true,
    theme: true,
    accent: true,
  },
  {
    id: 'photo-side',
    label: t('摄影侧栏'),
    category: 'photo',
    style: 'side',
    align: 'center',
    time: true,
    theme: true,
  },
  {
    id: 'photo-poster',
    label: t('摄影留白'),
    category: 'photo',
    style: 'poster',
    align: 'center',
    time: true,
    theme: true,
    accent: true,
  },
  {
    id: 'standard-left',
    label: t('左下签名'),
    category: 'standard',
    style: 'overlay',
    align: 'left',
    time: true,
    theme: true,
  },
  {
    id: 'standard-right',
    label: t('右下签名'),
    category: 'standard',
    style: 'overlay',
    align: 'right',
    time: true,
    theme: true,
  },
  {
    id: 'classic-strip',
    label: t('经典信息条'),
    category: 'classic',
    style: 'strip',
    align: 'center',
    time: true,
    theme: true,
  },
  {
    id: 'classic-frame',
    label: t('经典宽框'),
    category: 'classic',
    style: 'frame',
    align: 'left',
    time: true,
    theme: true,
    wide: true,
  },
  {
    id: 'film-perforated',
    label: t('胶片齿孔'),
    category: 'film',
    style: 'film',
    align: 'left',
    time: true,
    theme: false,
  },
  {
    id: 'film-dark',
    label: t('暗调胶片'),
    category: 'film',
    style: 'dark',
    align: 'center',
    time: true,
    theme: false,
  },
  {
    id: 'sport-tag',
    label: t('运动标记'),
    category: 'sport',
    style: 'overlay',
    align: 'left',
    time: false,
    theme: false,
    accent: true,
  },
  {
    id: 'sport-rail',
    label: t('运动侧框'),
    category: 'sport',
    style: 'side',
    align: 'center',
    time: false,
    theme: true,
    accent: true,
  },
  {
    id: 'frame-minimal',
    label: t('极简相框'),
    category: 'frame',
    style: 'frame',
    align: 'center',
    time: true,
    theme: true,
  },
  {
    id: 'frame-poster',
    label: t('海报相框'),
    category: 'frame',
    style: 'poster',
    align: 'left',
    time: true,
    theme: true,
  },
];
export const WATERMARK_CATEGORIES: readonly { id: WatermarkCategory; label: string }[] = [
  { id: 'photo', label: t('摄影') },
  { id: 'standard', label: t('标准') },
  { id: 'classic', label: t('经典') },
  { id: 'film', label: t('胶片') },
  { id: 'sport', label: t('运动') },
  { id: 'frame', label: t('相框') },
];
export interface PhotoMetadata {
  camera?: string;
  parameters?: string;
  capturedAt?: string;
}

export function findWatermark(id: string): WatermarkTemplate | undefined {
  return WATERMARK_TEMPLATES.find((template) => template.id === id);
}

export function photoWatermarkLayout(width: number, height: number, template: WatermarkTemplate) {
  // Expand the canvas rather than resampling the original photo to fit the frame.
  if (template.style === 'overlay')
    return { width, height, x: 0, y: 0, photoWidth: width, photoHeight: height, caption: 0 };
  const margin = Math.round(
    width *
      (template.style === 'frame'
        ? template.wide
          ? 0.08
          : 0.04
        : template.style === 'poster'
          ? 0.08
          : template.style === 'film'
            ? 0.025
            : 0.03),
  );
  const caption = Math.max(
    1,
    Math.round(
      width * (template.style === 'poster' ? 0.22 : template.style === 'side' ? 0.17 : 0.13),
    ),
  );
  return {
    width: width + margin * 2 + (template.style === 'side' ? caption : 0),
    height: height + margin * 2 + (template.style === 'side' ? 0 : caption),
    x: margin,
    y: margin,
    photoWidth: width,
    photoHeight: height,
    caption,
  };
}
