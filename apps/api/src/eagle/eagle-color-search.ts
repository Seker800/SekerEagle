import { BadRequestException } from '@nestjs/common';

export const COLOR_PROCESSOR_VERSION = 'color-v3-thumbnail';
export const COLOR_MATCH_DISTANCE = 20;
export const COLOR_MINIMUM_WEIGHT = 0.03;

export interface LabColor {
  labL: number;
  labA: number;
  labB: number;
}

export function normalizeHexColor(value: string): string {
  const color = value.normalize('NFKC').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new BadRequestException('颜色筛选值无效，请使用 #rrggbb。');
  }
  return color;
}

export function rgbToLab(red: number, green: number, blue: number): LabColor {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0]! * 0.4124 + linear[1]! * 0.3576 + linear[2]! * 0.1805) / 0.95047;
  const y = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  const z = (linear[0]! * 0.0193 + linear[1]! * 0.1192 + linear[2]! * 0.9505) / 1.08883;
  const transform = (component: number) =>
    component > 0.008856 ? Math.cbrt(component) : 7.787 * component + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return {
    labL: 116 * fy - 16,
    labA: 500 * (fx - fy),
    labB: 200 * (fy - fz),
  };
}

export function hexToLab(value: string): LabColor {
  const color = normalizeHexColor(value);
  return rgbToLab(
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  );
}

export function colorDistance(left: LabColor, right: LabColor): number {
  return Math.hypot(left.labL - right.labL, left.labA - right.labA, left.labB - right.labB);
}

export function buildColorAnalysisWhere(value: string) {
  const target = hexToLab(value);
  const range = (component: number) => ({
    gte: component - COLOR_MATCH_DISTANCE,
    lte: component + COLOR_MATCH_DISTANCE,
  });
  return {
    some: {
      isCurrent: true,
      processorVersion: COLOR_PROCESSOR_VERSION,
      status: 'COMPLETED' as const,
      swatches: {
        some: {
          weight: { gte: COLOR_MINIMUM_WEIGHT },
          labL: range(target.labL),
          labA: range(target.labA),
          labB: range(target.labB),
        },
      },
    },
  };
}
