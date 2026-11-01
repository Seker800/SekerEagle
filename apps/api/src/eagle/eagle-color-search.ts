import { BadRequestException } from '@nestjs/common';
import { COLOR_PALETTE_VERSION } from '@sekereagle/library-core';
import type { AssetSearchWhere } from './eagle-search-predicate';

export const COLOR_PROCESSOR_VERSION = COLOR_PALETTE_VERSION;

export function normalizeHexColor(value: string): string {
  const color = value.normalize('NFKC').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new BadRequestException('颜色筛选值无效，请使用 #rrggbb。');
  }
  return color;
}

/** Exact SQL color leaf, evaluated by the shared asset-search adapter. */
export function buildColorMatchWhere(value: string): AssetSearchWhere {
  return { colorMatch: normalizeHexColor(value) };
}
