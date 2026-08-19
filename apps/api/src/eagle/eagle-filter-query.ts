import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  isActiveEagleFilterRule,
  parseEagleFilterQuery,
  type EagleFilterCondition,
  type EagleFilterQuery,
  type EagleFilterRule,
} from '@sekereagle/eagle-filter-core';
import { buildColorAnalysisWhere } from './eagle-color-search';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function readEagleFilterQuery(value: unknown): EagleFilterQuery {
  try {
    return parseEagleFilterQuery(value);
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : '筛选规则无效。');
  }
}

export function buildEagleFilterWhere(query: EagleFilterQuery): Prisma.EagleAssetWhereInput {
  const conditions = query.conditions
    .map(buildConditionWhere)
    .filter((where): where is Prisma.EagleAssetWhereInput => where !== null);
  return conditions.length ? { AND: conditions } : {};
}

export function readEagleFilterTagDependencies(query: EagleFilterQuery): {
  manualTagIds: string[];
  aiTagIds: string[];
} {
  const manualTagIds = new Set<string>();
  const aiTagIds = new Set<string>();
  for (const condition of query.conditions) {
    for (const rule of condition.rules) {
      if (!Array.isArray(rule.value) || rule.value.some((id) => typeof id !== 'string')) continue;
      const target =
        rule.field === 'MANUAL_TAGS' ? manualTagIds : rule.field === 'AI_TAGS' ? aiTagIds : null;
      if (target) for (const id of rule.value as string[]) target.add(id);
    }
  }
  return { manualTagIds: [...manualTagIds], aiTagIds: [...aiTagIds] };
}

function buildConditionWhere(condition: EagleFilterCondition): Prisma.EagleAssetWhereInput | null {
  const rules = condition.rules.filter(isActiveEagleFilterRule).map(buildRuleWhere);
  if (!rules.length) return null;
  const group: Prisma.EagleAssetWhereInput =
    condition.match === 'ALL' ? { AND: rules } : { OR: rules };
  return condition.result === 'NOT_MATCH' ? { NOT: group } : group;
}

function buildRuleWhere(rule: EagleFilterRule): Prisma.EagleAssetWhereInput {
  switch (rule.field) {
    case 'NAME':
      return buildTextWhere('NAME', rule);
    case 'DESCRIPTION':
      return buildTextWhere('DESCRIPTION', rule);
    case 'SOURCE_URL':
      return buildTextWhere('SOURCE_URL', rule);
    case 'FORMAT':
      return rule.operator === 'NOT_EQUALS'
        ? { format: { not: readString(rule).toLowerCase() } }
        : { format: readString(rule).toLowerCase() };
    case 'MANUAL_TAGS':
      return buildTagWhere('MANUAL', rule);
    case 'AI_TAGS':
      return buildTagWhere('AI', rule);
    case 'RATING':
      return buildRatingWhere(rule);
    case 'WIDTH':
      return { width: buildNumberFilter(rule) };
    case 'HEIGHT':
      return { height: buildNumberFilter(rule) };
    case 'FILE_SIZE':
      return { byteSize: buildBigIntFilter(rule, fileSizeMultiplier(rule.unit)) };
    case 'DURATION':
      return { durationMs: buildNumberFilter(rule, durationMultiplier(rule.unit)) };
    case 'SHAPE':
      return buildShapeWhere(rule);
    case 'COLOR': {
      const color = readString(rule);
      if (!HEX_COLOR.test(color)) throw new BadRequestException('颜色筛选值无效。');
      return { colorAnalyses: buildColorAnalysisWhere(color) };
    }
    case 'ADDED_AT':
      return { libraryAddedAt: buildDateFilter(rule) };
    case 'MODIFIED_AT':
      return { updatedAt: buildDateFilter(rule) };
  }
}

function buildTextWhere(
  field: 'NAME' | 'DESCRIPTION' | 'SOURCE_URL',
  rule: EagleFilterRule,
): Prisma.EagleAssetWhereInput {
  if (field === 'NAME') {
    const value =
      typeof rule.value === 'string' ? rule.value.normalize('NFKC').toLocaleLowerCase() : '';
    const filter = textFilter(rule.operator, value);
    return { normalizedDisplayName: filter };
  }
  const relationField = field === 'DESCRIPTION' ? 'description' : 'sourceUrl';
  if (rule.operator === 'EMPTY') {
    return {
      OR: [
        { annotation: { is: null } },
        { annotation: { is: { [relationField]: null } } },
        { annotation: { is: { [relationField]: '' } } },
      ],
    };
  }
  if (rule.operator === 'NOT_EMPTY') {
    return {
      annotation: { is: { [relationField]: { not: null } } },
      NOT: { annotation: { is: { [relationField]: '' } } },
    };
  }
  return {
    annotation: {
      is: { [relationField]: textFilter(rule.operator, readString(rule)) },
    },
  };
}

function textFilter(operator: EagleFilterRule['operator'], value: string): Prisma.StringFilter {
  switch (operator) {
    case 'CONTAINS':
      return { contains: value, mode: 'insensitive' };
    case 'NOT_CONTAINS':
      return { not: { contains: value }, mode: 'insensitive' };
    case 'STARTS_WITH':
      return { startsWith: value, mode: 'insensitive' };
    case 'ENDS_WITH':
      return { endsWith: value, mode: 'insensitive' };
    case 'NOT_EQUALS':
      return { not: value, mode: 'insensitive' };
    case 'EMPTY':
      return { equals: '' };
    case 'NOT_EMPTY':
      return { not: '' };
    default:
      return { equals: value, mode: 'insensitive' };
  }
}

function buildTagWhere(
  source: 'MANUAL' | 'AI',
  rule: EagleFilterRule,
): Prisma.EagleAssetWhereInput {
  const ids = readStringArray(rule);
  const some = (id?: string): Prisma.EagleAssetWhereInput =>
    source === 'MANUAL'
      ? { manualTagLinks: { some: id ? { tagId: id } : {} } }
      : { aiTagLinks: { some: { ...(id ? { aiTagId: id } : {}), status: 'ACTIVE' } } };
  const none = (selectedIds?: string[]): Prisma.EagleAssetWhereInput =>
    source === 'MANUAL'
      ? { manualTagLinks: { none: selectedIds ? { tagId: { in: selectedIds } } : {} } }
      : {
          aiTagLinks: {
            none: { ...(selectedIds ? { aiTagId: { in: selectedIds } } : {}), status: 'ACTIVE' },
          },
        };
  switch (rule.operator) {
    case 'ANY_OF':
      return source === 'MANUAL'
        ? { manualTagLinks: { some: { tagId: { in: ids } } } }
        : { aiTagLinks: { some: { aiTagId: { in: ids }, status: 'ACTIVE' } } };
    case 'NONE_OF':
      return none(ids);
    case 'EMPTY':
      return none();
    case 'NOT_EMPTY':
      return some();
    default:
      return { AND: ids.map((id) => some(id)) };
  }
}

function buildRatingWhere(rule: EagleFilterRule): Prisma.EagleAssetWhereInput {
  const value = Number(readString(rule));
  if (!Number.isInteger(value) || value < 0 || value > 5)
    throw new BadRequestException('评分筛选值无效。');
  if (value === 0)
    return rule.operator === 'NOT_EQUALS' ? { rating: { not: null } } : { rating: null };
  switch (rule.operator) {
    case 'NOT_EQUALS':
      return { rating: { not: value } };
    case 'GTE':
      return { rating: { gte: value } };
    case 'LTE':
      return { rating: { lte: value } };
    default:
      return { rating: value };
  }
}

function buildNumberFilter(rule: EagleFilterRule, multiplier = 1): Prisma.IntNullableFilter {
  const values = readNumberValues(rule).map((value) => Math.round(value * multiplier));
  switch (rule.operator) {
    case 'GT':
      return { gt: values[0] };
    case 'GTE':
      return { gte: values[0] };
    case 'LT':
      return { lt: values[0] };
    case 'LTE':
      return { lte: values[0] };
    case 'NOT_EQUALS':
      return { not: values[0] };
    case 'BETWEEN':
      return { gte: Math.min(...values), lte: Math.max(...values) };
    default:
      return { equals: values[0] };
  }
}

function buildBigIntFilter(rule: EagleFilterRule, multiplier: number): Prisma.BigIntFilter {
  const values = readNumberValues(rule).map((value) => BigInt(Math.round(value * multiplier)));
  switch (rule.operator) {
    case 'GT':
      return { gt: values[0] };
    case 'GTE':
      return { gte: values[0] };
    case 'LT':
      return { lt: values[0] };
    case 'LTE':
      return { lte: values[0] };
    case 'NOT_EQUALS':
      return { not: values[0] };
    case 'BETWEEN':
      return values[0]! <= values[1]!
        ? { gte: values[0], lte: values[1] }
        : { gte: values[1], lte: values[0] };
    default:
      return { equals: values[0] };
  }
}

function buildDateFilter(rule: EagleFilterRule): Prisma.DateTimeFilter {
  if (rule.operator === 'WITHIN_DAYS') {
    const days = readNumberValues(rule)[0]!;
    if (days <= 0 || days > 36500) throw new BadRequestException('最近天数必须大于 0。');
    return { gte: new Date(Date.now() - days * 86_400_000) };
  }
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  const dates = values.map((value) => {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException('日期筛选值无效。');
    return date;
  });
  if (rule.operator === 'BEFORE') return { lt: dates[0] };
  if (rule.operator === 'BETWEEN') {
    const [start, end] = dates;
    if (!start || !end) throw new BadRequestException('日期区间缺少结束日期。');
    return start <= end ? { gte: start, lte: end } : { gte: end, lte: start };
  }
  return { gt: dates[0] };
}

function buildShapeWhere(rule: EagleFilterRule): Prisma.EagleAssetWhereInput {
  const shape = readString(rule);
  const ranges: Record<string, Prisma.EagleAssetWhereInput> = {
    LANDSCAPE: { aspectRatio: { gt: 1.05, lte: 2 } },
    PORTRAIT: { aspectRatio: { gte: 0.5, lt: 0.95 } },
    SQUARE: { aspectRatio: { gte: 0.95, lte: 1.05 } },
    PANORAMA: { OR: [{ aspectRatio: { gt: 2 } }, { aspectRatio: { lt: 0.5 } }] },
  };
  const where = ranges[shape];
  if (!where) throw new BadRequestException('形状筛选值无效。');
  return rule.operator === 'NOT_EQUALS' ? { NOT: where } : where;
}

function readString(rule: EagleFilterRule): string {
  if (typeof rule.value !== 'string') throw new BadRequestException('筛选规则需要文本值。');
  return rule.value.normalize('NFKC').trim();
}

function readStringArray(rule: EagleFilterRule): string[] {
  if (!Array.isArray(rule.value) || rule.value.some((value) => typeof value !== 'string'))
    throw new BadRequestException('标签筛选值无效。');
  return rule.value as string[];
}

function readNumberValues(rule: EagleFilterRule): number[] {
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  if (
    values.length === 0 ||
    values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  )
    throw new BadRequestException('数值筛选值无效。');
  if (rule.operator === 'BETWEEN' && values.length !== 2)
    throw new BadRequestException('区间筛选需要两个数值。');
  return values as number[];
}

function fileSizeMultiplier(unit: EagleFilterRule['unit']): number {
  if (unit === 'GB') return 1024 ** 3;
  if (unit === 'KB') return 1024;
  return 1024 ** 2;
}

function durationMultiplier(unit: EagleFilterRule['unit']): number {
  if (unit === 'HOURS') return 3_600_000;
  if (unit === 'MINUTES') return 60_000;
  return 1_000;
}
