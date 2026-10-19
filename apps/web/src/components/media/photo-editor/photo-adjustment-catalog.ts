import { t } from '../../../i18n';
import type { PhotoEdits } from './photo-editor-model';

export type AdjustmentGroup = 'tone' | 'color' | 'detail';
export type ActiveAdjustmentKey =
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
}

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
  { id: 'sharpen', label: t('锐化'), group: 'detail', key: 'sharpen', min: 0 },
  { id: 'clarity', label: t('清晰度'), group: 'detail', key: 'clarity', min: 0 },
  { id: 'grain', label: t('颗粒'), group: 'detail', key: 'grain', min: 0 },
  { id: 'vignette', label: t('晕影'), group: 'detail', key: 'vignette' },
];

export const ADJUSTMENT_GROUPS: readonly { id: AdjustmentGroup; label: string }[] = [
  { id: 'tone', label: t('影调') },
  { id: 'color', label: t('色彩') },
  { id: 'detail', label: t('细节') },
];

export function adjustmentValue(option: PhotoAdjustmentOption, edits: PhotoEdits): string {
  if (!option.key) return '—';
  const value = edits[option.key];
  return `${value > 0 ? '+' : ''}${value.toFixed(option.step && option.step < 1 ? 2 : 0)}`;
}
