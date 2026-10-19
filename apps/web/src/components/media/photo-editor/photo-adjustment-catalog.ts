import { t } from '../../../i18n';
import { DEFAULT_PHOTO_EDITS, type PhotoEdits } from './photo-editor-model';

import {
  HSL_BANDS,
  HSL_CENTERS,
  HSL_AXES,
  CURVE_CHANNELS,
  CURVE_POINTS,
  GRADE_ZONES,
  hslKey,
  curveKey,
  gradeKey,
  type AdvancedKey,
} from './photo-editor-advanced-model';
export type AdvancedAdjustmentGroup = 'hsl' | 'curves' | 'grading';
export type AdjustmentGroup = 'tone' | 'color' | 'detail' | AdvancedAdjustmentGroup;
export type ActiveAdjustmentKey =
  | AdvancedKey
  | 'dehaze'
  | 'luminanceNoise'
  | 'colorNoise'
  | 'exposure'
  | 'contrast'
  | 'saturation'
  | 'gamma'
  | 'brightness'
  | 'lightPerception'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'vibrance'
  | 'temperature'
  | 'tint'
  | 'fade'
  | 'sharpen'
  | 'clarity'
  | 'grain'
  | 'vignette';
export interface PhotoAdjustmentOption {
  id: string;
  label: string;
  group: AdjustmentGroup;
  key: ActiveAdjustmentKey;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  family?: string;
  familyLabel?: string;
  familyColor?: string;
  axisLabel?: string;
}

const BAND_LABELS = [
  t('红色'),
  t('橙色'),
  t('黄色'),
  t('绿色'),
  t('青色'),
  t('蓝色'),
  t('紫色'),
  t('洋红'),
];
const AXIS_LABELS = [t('色相'), t('饱和度'), t('明度')];
const CHANNEL_LABELS = [t('主曲线'), t('红色'), t('绿色'), t('蓝色')];
const POINT_LABELS = [t('黑场'), t('暗部'), t('中间调'), t('亮部'), t('白场')];
const ZONE_LABELS = [t('阴影'), t('中间调'), t('高光')];
export const ADVANCED_ADJUSTMENTS: readonly PhotoAdjustmentOption[] = [
  ...HSL_BANDS.flatMap((band, i) =>
    HSL_AXES.map((axis, j) => ({
      id: hslKey(band, axis),
      key: hslKey(band, axis),
      group: 'hsl' as const,
      label: `${BAND_LABELS[i]} · ${AXIS_LABELS[j]}`,
      family: band,
      familyLabel: BAND_LABELS[i],
      familyColor: `hsl(${HSL_CENTERS[i]} 70% 55%)`,
      axisLabel: AXIS_LABELS[j],
    })),
  ),
  ...CURVE_CHANNELS.flatMap((channel, i) =>
    CURVE_POINTS.map((point) => ({
      id: curveKey(channel, point),
      key: curveKey(channel, point),
      group: 'curves' as const,
      label: `${CHANNEL_LABELS[i]} · ${POINT_LABELS[point]}`,
      family: channel,
      familyLabel: CHANNEL_LABELS[i],
      axisLabel: POINT_LABELS[point],
      min: -point * 25,
      max: 100 - point * 25,
    })),
  ),
  ...GRADE_ZONES.flatMap((zone, i) =>
    HSL_AXES.map((axis, j) => ({
      id: gradeKey(zone, axis),
      key: gradeKey(zone, axis),
      group: 'grading' as const,
      label: `${ZONE_LABELS[i]} · ${AXIS_LABELS[j]}`,
      family: zone,
      familyLabel: ZONE_LABELS[i],
      axisLabel: AXIS_LABELS[j],
      min: axis === 'Luminance' ? -100 : 0,
      max: axis === 'Hue' ? 360 : 100,
      unit: axis === 'Hue' ? '°' : undefined,
    })),
  ),
  {
    id: 'gradeBalance',
    key: 'gradeBalance',
    group: 'grading',
    label: t('分级平衡'),
    family: 'Balance',
    familyLabel: t('平衡'),
    axisLabel: t('平衡'),
  },
];

// Menu structure follows sekerwatermark's tone / color / detail groups.
// Each entry is connected to a real pixel operation and the common undo/save state.
export const PHOTO_ADJUSTMENTS: readonly PhotoAdjustmentOption[] = [
  {
    id: 'exposure',
    label: t('曝光'),
    group: 'tone',
    key: 'exposure',
    min: -1,
    max: 1,
    step: 0.01,
    unit: 'EV',
  },
  { id: 'brightness', label: t('亮度'), group: 'tone', key: 'brightness' },
  { id: 'contrast', label: t('对比度'), group: 'tone', key: 'contrast' },
  { id: 'lightPerception', label: t('光感'), group: 'tone', key: 'lightPerception' },
  { id: 'highlights', label: t('高光'), group: 'tone', key: 'highlights' },
  { id: 'shadows', label: t('阴影'), group: 'tone', key: 'shadows' },
  { id: 'whites', label: t('白色色阶'), group: 'tone', key: 'whites' },
  { id: 'blacks', label: t('黑色色阶'), group: 'tone', key: 'blacks' },
  { id: 'gamma', label: t('中间调'), group: 'tone', key: 'gamma' },
  { id: 'saturation', label: t('饱和度'), group: 'color', key: 'saturation' },
  { id: 'vibrance', label: t('自然饱和度'), group: 'color', key: 'vibrance' },
  { id: 'temperature', label: t('色温'), group: 'color', key: 'temperature' },
  { id: 'tint', label: t('色调'), group: 'color', key: 'tint' },
  { id: 'fade', label: t('褪色'), group: 'color', key: 'fade', min: 0 },
  { id: 'sharpen', label: t('锐化'), group: 'detail', key: 'sharpen' },
  { id: 'clarity', label: t('清晰度'), group: 'detail', key: 'clarity' },
  { id: 'grain', label: t('颗粒'), group: 'detail', key: 'grain', min: 0 },
  { id: 'vignette', label: t('晕影'), group: 'detail', key: 'vignette' },
  { id: 'dehaze', label: t('去雾'), group: 'tone', key: 'dehaze' },
  { id: 'luminanceNoise', label: t('明度降噪'), group: 'detail', key: 'luminanceNoise', min: 0 },
  { id: 'colorNoise', label: t('色彩降噪'), group: 'detail', key: 'colorNoise', min: 0 },
  ...ADVANCED_ADJUSTMENTS,
];

export const ADJUSTMENT_GROUPS: readonly { id: AdjustmentGroup; label: string }[] = [
  { id: 'tone', label: t('影调') },
  { id: 'color', label: t('色彩') },
  { id: 'detail', label: t('细节') },
  { id: 'hsl', label: t('HSL') },
  { id: 'curves', label: t('曲线') },
  { id: 'grading', label: t('色彩分级') },
];

export function adjustmentValue(option: PhotoAdjustmentOption, edits: PhotoEdits): string {
  if (!option.key) return '—';
  const value = edits[option.key];
  return `${value > 0 ? '+' : ''}${value.toFixed(option.step && option.step < 1 ? 2 : 0)}`;
}

/** Reset only the catalogued pixel adjustments; framing and watermark remain intact. */
export function resetPhotoAdjustments(edits: PhotoEdits): PhotoEdits {
  return {
    ...edits,
    ...Object.fromEntries(PHOTO_ADJUSTMENTS.map(({ key }) => [key, DEFAULT_PHOTO_EDITS[key]])),
  };
}
