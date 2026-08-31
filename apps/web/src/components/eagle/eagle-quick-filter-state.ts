import { t } from '../../i18n';
import {
  createEagleFilterCondition,
  createEagleFilterRule,
  type EagleFilterField,
  type EagleFilterQuery,
  type EagleFilterRule,
} from '@sekereagle/eagle-filter-core';
export type EagleQuickFilterField = EagleFilterField;
export type EagleQuickTagMatch = 'ANY' | 'ALL';
export type EagleQuickRangeField = 'WIDTH' | 'HEIGHT' | 'FILE_SIZE' | 'DURATION';
export type EagleQuickDateField = 'ADDED_AT' | 'MODIFIED_AT';
export type EagleQuickTextField = 'NAME' | 'DESCRIPTION' | 'SOURCE_URL';
export interface EagleQuickNumberRange {
  min: string;
  max: string;
  unit?: NonNullable<EagleFilterRule['unit']>;
}
export interface EagleQuickDateRange {
  from: string;
  to: string;
}
export interface EagleQuickFilterState {
  color?: string;
  manualTagIds: string[];
  manualTagMatch: EagleQuickTagMatch;
  aiTagIds: string[];
  aiTagMatch: EagleQuickTagMatch;
  formats: string[];
  shapes: string[];
  ratingAtLeast?: number;
  ranges: Partial<Record<EagleQuickRangeField, EagleQuickNumberRange>>;
  dates: Partial<Record<EagleQuickDateField, EagleQuickDateRange>>;
  text: Partial<Record<EagleQuickTextField, string>>;
}
export const DEFAULT_EAGLE_QUICK_FILTER_FIELDS: readonly EagleQuickFilterField[] = [
  'COLOR',
  'MANUAL_TAGS',
  'SHAPE',
  'RATING',
  'FORMAT',
];
export const EAGLE_QUICK_FILTER_FIELD_LABELS: Record<EagleQuickFilterField, string> = {
  COLOR: t('颜色'),
  MANUAL_TAGS: t('标签'),
  AI_TAGS: t('AI 标签'),
  SHAPE: t('形状'),
  RATING: t('评分'),
  FORMAT: t('格式'),
  WIDTH: t('宽度'),
  HEIGHT: t('高度'),
  FILE_SIZE: t('大小'),
  DURATION: t('时长'),
  NAME: t('名称'),
  DESCRIPTION: t('注释'),
  SOURCE_URL: t('链接'),
  ADDED_AT: t('添加日期'),
  MODIFIED_AT: t('修改日期'),
};
export const EAGLE_QUICK_FILTER_FIELDS: readonly EagleQuickFilterField[] = [
  ...DEFAULT_EAGLE_QUICK_FILTER_FIELDS,
  'AI_TAGS',
  'WIDTH',
  'HEIGHT',
  'FILE_SIZE',
  'DURATION',
  'NAME',
  'DESCRIPTION',
  'SOURCE_URL',
  'ADDED_AT',
  'MODIFIED_AT',
];
export function createEmptyEagleQuickFilterState(): EagleQuickFilterState {
  return {
    manualTagIds: [],
    manualTagMatch: 'ANY',
    aiTagIds: [],
    aiTagMatch: 'ANY',
    formats: [],
    shapes: [],
    ranges: {},
    dates: {},
    text: {},
  };
}
export function countActiveEagleQuickFilters(state: EagleQuickFilterState): number {
  return EAGLE_QUICK_FILTER_FIELDS.filter((field) => isEagleQuickFilterActive(state, field)).length;
}
export function isEagleQuickFilterActive(
  state: EagleQuickFilterState,
  field: EagleQuickFilterField,
): boolean {
  switch (field) {
    case 'COLOR':
      return Boolean(state.color);
    case 'MANUAL_TAGS':
      return state.manualTagIds.length > 0;
    case 'AI_TAGS':
      return state.aiTagIds.length > 0;
    case 'FORMAT':
      return state.formats.length > 0;
    case 'SHAPE':
      return state.shapes.length > 0;
    case 'RATING':
      return state.ratingAtLeast !== undefined;
    case 'WIDTH':
    case 'HEIGHT':
    case 'FILE_SIZE':
    case 'DURATION': {
      const range = state.ranges[field];
      return Boolean(range?.min.trim() || range?.max.trim());
    }
    case 'ADDED_AT':
    case 'MODIFIED_AT': {
      const range = state.dates[field];
      return Boolean(range?.from || range?.to);
    }
    case 'NAME':
    case 'DESCRIPTION':
    case 'SOURCE_URL':
      return Boolean(state.text[field]?.trim());
  }
}
export function summarizeEagleQuickFilter(
  state: EagleQuickFilterState,
  field: EagleQuickFilterField,
): string | undefined {
  switch (field) {
    case 'COLOR':
      return state.color?.toUpperCase();
    case 'MANUAL_TAGS':
      return state.manualTagIds.length ? String(state.manualTagIds.length) : undefined;
    case 'AI_TAGS':
      return state.aiTagIds.length ? String(state.aiTagIds.length) : undefined;
    case 'FORMAT':
      return state.formats.length
        ? state.formats.map((value) => value.toUpperCase()).join('、')
        : undefined;
    case 'SHAPE':
      return state.shapes.length ? String(state.shapes.length) : undefined;
    case 'RATING':
      return state.ratingAtLeast === undefined ? undefined : `≥ ${state.ratingAtLeast}`;
    case 'WIDTH':
    case 'HEIGHT':
    case 'FILE_SIZE':
    case 'DURATION': {
      const range = state.ranges[field];
      if (!range) return undefined;
      const suffix = range.unit ? ` ${range.unit}` : '';
      if (range.min && range.max) return `${range.min}–${range.max}${suffix}`;
      if (range.min) return `≥ ${range.min}${suffix}`;
      if (range.max) return `≤ ${range.max}${suffix}`;
      return undefined;
    }
    case 'ADDED_AT':
    case 'MODIFIED_AT': {
      const range = state.dates[field];
      if (!range) return undefined;
      return range.from && range.to ? `${range.from}–${range.to}` : range.from || range.to;
    }
    case 'NAME':
    case 'DESCRIPTION':
    case 'SOURCE_URL':
      return state.text[field]?.trim() || undefined;
  }
}
export function clearEagleQuickFilter(
  state: EagleQuickFilterState,
  field: EagleQuickFilterField,
): EagleQuickFilterState {
  switch (field) {
    case 'COLOR':
      return { ...state, color: undefined };
    case 'MANUAL_TAGS':
      return { ...state, manualTagIds: [] };
    case 'AI_TAGS':
      return { ...state, aiTagIds: [] };
    case 'FORMAT':
      return { ...state, formats: [] };
    case 'SHAPE':
      return { ...state, shapes: [] };
    case 'RATING':
      return { ...state, ratingAtLeast: undefined };
    case 'WIDTH':
    case 'HEIGHT':
    case 'FILE_SIZE':
    case 'DURATION': {
      const ranges = { ...state.ranges };
      delete ranges[field];
      return { ...state, ranges };
    }
    case 'ADDED_AT':
    case 'MODIFIED_AT': {
      const dates = { ...state.dates };
      delete dates[field];
      return { ...state, dates };
    }
    case 'NAME':
    case 'DESCRIPTION':
    case 'SOURCE_URL': {
      const text = { ...state.text };
      delete text[field];
      return { ...state, text };
    }
  }
}
export function buildEagleQuickFilterQuery(state: EagleQuickFilterState): EagleFilterQuery {
  const conditions: EagleFilterQuery['conditions'] = [];
  const addCondition = (rules: EagleFilterRule[], match: 'ALL' | 'ANY' = 'ALL') => {
    if (!rules.length) return;
    const condition = createEagleFilterCondition();
    condition.match = match;
    condition.rules = rules;
    conditions.push(condition);
  };
  const addRule = (
    field: EagleFilterField,
    operator: EagleFilterRule['operator'],
    value: EagleFilterRule['value'],
    unit?: EagleFilterRule['unit'],
  ) => {
    addCondition([{ ...createEagleFilterRule(field), operator, value, ...(unit ? { unit } : {}) }]);
  };
  if (state.color) addRule('COLOR', 'SIMILAR', state.color);
  if (state.manualTagIds.length) {
    addRule(
      'MANUAL_TAGS',
      state.manualTagMatch === 'ALL' ? 'ALL_OF' : 'ANY_OF',
      state.manualTagIds,
    );
  }
  if (state.aiTagIds.length) {
    addRule('AI_TAGS', state.aiTagMatch === 'ALL' ? 'ALL_OF' : 'ANY_OF', state.aiTagIds);
  }
  addChoiceRules(conditions, 'FORMAT', state.formats);
  addChoiceRules(conditions, 'SHAPE', state.shapes);
  if (state.ratingAtLeast !== undefined) addRule('RATING', 'GTE', String(state.ratingAtLeast));
  for (const field of ['WIDTH', 'HEIGHT', 'FILE_SIZE', 'DURATION'] as const) {
    const range = state.ranges[field];
    if (!range) continue;
    const min = parseNonNegativeNumber(range.min);
    const max = parseNonNegativeNumber(range.max);
    if (min !== undefined && max !== undefined) addRule(field, 'BETWEEN', [min, max], range.unit);
    else if (min !== undefined) addRule(field, 'GTE', min, range.unit);
    else if (max !== undefined) addRule(field, 'LTE', max, range.unit);
  }
  for (const field of ['ADDED_AT', 'MODIFIED_AT'] as const) {
    const range = state.dates[field];
    if (!range) continue;
    if (range.from && range.to) addRule(field, 'BETWEEN', [range.from, range.to]);
    else if (range.from) addRule(field, 'AFTER', range.from);
    else if (range.to) addRule(field, 'BEFORE', range.to);
  }
  for (const field of ['NAME', 'DESCRIPTION', 'SOURCE_URL'] as const) {
    const value = state.text[field]?.trim();
    if (value) addRule(field, 'CONTAINS', value);
  }
  return { version: 2, conditions };
}
function addChoiceRules(
  conditions: EagleFilterQuery['conditions'],
  field: 'FORMAT' | 'SHAPE',
  values: string[],
) {
  if (!values.length) return;
  const condition = createEagleFilterCondition();
  condition.match = 'ANY';
  condition.rules = values.map((value) => ({
    ...createEagleFilterRule(field),
    operator: 'EQUALS',
    value,
  }));
  conditions.push(condition);
}
function parseNonNegativeNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
