import { describe, expect, it } from 'vitest';
import { buildPhotoTimelineScale } from './photo-timeline-scale';

const month = (month: string, count = 1) => ({ month, count });

describe('photo timeline scale', () => {
  it('handles empty and single-month libraries without invented dates', () => {
    expect(buildPhotoTimelineScale([])).toEqual({ positions: [], years: [], breaks: [] });
    expect(buildPhotoTimelineScale([month('2001-04')])).toEqual({
      positions: [0], years: [{ year: 2001, top: 0 }], breaks: [],
    });
  });

  it('gives a populated year more space and keeps a sparse old year reachable', () => {
    const scale = buildPhotoTimelineScale([
      month('2026-12', 500), month('2026-01', 500),
      month('2001-12'), month('2001-01'),
    ]);
    const [newest, recentEnd, oldStart, oldest] = scale.positions;
    expect(newest).toBe(0);
    expect(oldest).toBe(100);
    expect(recentEnd - newest).toBeGreaterThan((oldest - oldStart) * 2);
    expect(recentEnd).toBeGreaterThan(60);
    expect(scale.years.map(({ year }) => year)).toEqual([2026, 2001]);
    expect(scale.breaks).toHaveLength(1);
    expect(scale.breaks[0].top).toBeGreaterThan(recentEnd);
    expect(scale.breaks[0].top).toBeLessThan(oldStart);
  });

  it('bounds the influence of a huge photo count', () => {
    const scale = buildPhotoTimelineScale([
      month('2026-12', 1_000_000), month('2026-01', 1_000_000),
      month('2025-12'), month('2025-01'),
    ]);
    expect(scale.positions[1]).toBeLessThanOrEqual(80);
    expect(scale.positions[3] - scale.positions[2]).toBeGreaterThanOrEqual(20);
    expect(scale.breaks).toEqual([]);
  });

  it('preserves calendar spacing within a year rather than weighting each month', () => {
    const scale = buildPhotoTimelineScale([
      month('2026-12', 1000), month('2026-09'), month('2026-06'), month('2026-01'),
    ]);
    expect(scale.positions[0]).toBe(0);
    expect(scale.positions[1]).toBeCloseTo(300 / 11);
    expect(scale.positions[2]).toBeCloseTo(600 / 11);
    expect(scale.positions[3]).toBe(100);
  });

  it('compresses arbitrarily long empty year ranges into the same marked gap', () => {
    const near = buildPhotoTimelineScale([month('2026-10'), month('2024-03'), month('2001-01')]);
    const far = buildPhotoTimelineScale([month('2026-10'), month('2024-03'), month('1801-01')]);
    expect(far.positions).toEqual(near.positions);
    expect(far.breaks.map(({ top }) => top)).toEqual(near.breaks.map(({ top }) => top));
  });

  it('keeps every month ordered for a century of sparse photos without changing inputs', () => {
    const months = Array.from({ length: 100 }, (_, index) => Object.freeze(month(`${2026 - index}-06`)));
    const scale = buildPhotoTimelineScale(Object.freeze(months));
    expect(scale.positions).toHaveLength(100);
    expect(scale.positions.every((top, index) => index === 0 || top > scale.positions[index - 1])).toBe(true);
    expect(scale.positions.at(-1)).toBe(100);
    expect(scale.breaks).toEqual([]);
  });
});
