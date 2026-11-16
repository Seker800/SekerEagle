import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EAGLE_FILTER_QUERY_VERSION, readEagleSemanticIntent } from '@sekereagle/eagle-filter-core';
import { readEagleFilterQuery, readEagleFilterTagDependencies } from './eagle-filter-query';

export type SmartFolderDependencies = { manualTagIds: string[] };

export function isEagleFilterQuery(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, Prisma.JsonValue>).version === EAGLE_FILTER_QUERY_VERSION,
  );
}

export function readSemanticIntent(query: Prisma.InputJsonValue | Prisma.JsonValue) {
  return isEagleFilterQuery(query)
    ? readEagleSemanticIntent(readEagleFilterQuery(query))
    : undefined;
}

export function privateVisibilityWhere(includePrivate: boolean): { isPrivate?: false } {
  return includePrivate ? {} : { isPrivate: false };
}

export function normalizeName(value: string, maxLength: number, label: string): string {
  const name = value.normalize('NFKC').trim();
  if (!name || name.length > maxLength) throw new BadRequestException(`${label}长度无效。`);
  return name;
}

export function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BadRequestException('颜色值无效。');
  return color;
}

export function normalizeSmartFolderQuery(
  query: Record<string, unknown>,
  defaultTagMatch?: 'ANY' | 'ALL',
): Prisma.InputJsonValue {
  if (query.version === EAGLE_FILTER_QUERY_VERSION) {
    return JSON.parse(JSON.stringify(readEagleFilterQuery(query))) as Prisma.InputJsonObject;
  }
  const candidate =
    query.version === 1 && query.filters && typeof query.filters === 'object'
      ? (query.filters as Record<string, unknown>)
      : query;
  const allowed = [
    'search',
    'rating',
    'format',
    'formats',
    'manualTagIds',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'createdFrom',
    'createdTo',
    'assetColor',
    'tagMatch',
  ];
  if (Object.keys(candidate).some((key) => !allowed.includes(key)))
    throw new BadRequestException('智能文件夹包含不支持的条件。');
  const filters = { ...candidate };
  if (defaultTagMatch && filters.tagMatch === undefined) filters.tagMatch = defaultTagMatch;
  if (
    filters.tagMatch !== undefined &&
    (typeof filters.tagMatch !== 'string' || !['ANY', 'ALL'].includes(filters.tagMatch))
  )
    throw new BadRequestException('智能文件夹标签匹配方式无效。');
  if (filters.manualTagIds !== undefined)
    readUniqueStringArray(filters.manualTagIds, 'manualTagIds');
  return { version: 1, filters: JSON.parse(JSON.stringify(filters)) as Prisma.InputJsonObject };
}

export function readSmartFolderDependencies(query: Prisma.InputJsonValue): SmartFolderDependencies {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('智能文件夹条件无效。');
  const root = query as Prisma.InputJsonObject;
  if (root.version === EAGLE_FILTER_QUERY_VERSION) {
    return readEagleFilterTagDependencies(readEagleFilterQuery(root));
  }
  const filters = root.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters))
    throw new BadRequestException('智能文件夹条件无效。');
  const record = filters as Prisma.InputJsonObject;
  return { manualTagIds: readUniqueStringArray(record.manualTagIds, '人工标签') };
}

export function readStoredQueryVersion(query: Prisma.InputJsonValue): number {
  return query &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    (query as Prisma.InputJsonObject).version === 2
    ? 2
    : 1;
}

export function readUniqueStringArray(
  value: Prisma.InputJsonValue | null | undefined,
  label: string,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
    throw new BadRequestException(`${label}条件无效。`);
  return [...new Set(value as string[])];
}

export function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function isForeignKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

export function visibleManualTagWhere(includePrivate: boolean): Prisma.EagleManualTagWhereInput {
  return includePrivate
    ? {}
    : {
        OR: [
          { marksAssetsPrivate: false, assetLinks: { none: {} } },
          { assetLinks: { some: { asset: { deletedAt: null, isPrivate: false } } } },
        ],
      };
}
