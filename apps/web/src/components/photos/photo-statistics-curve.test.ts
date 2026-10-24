import { describe, expect, it } from 'vitest';
import { smoothStatisticsPath } from './photo-statistics-curve';

describe('shape-preserving statistics curves', () => {
  it('draws cubic curves through every data point without introducing peaks or negative values', () => {
    const points = [
      [0, 0],
      [10, 0],
      [20, 5],
      [30, 2],
      [40, 0],
      [50, 0],
    ] as const;
    const path = smoothStatisticsPath(points);
    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path).not.toMatch(/NaN|Infinity| L /);
    const segments = path.split(' C ').slice(1);
    expect(segments.length).toBe(points.length - 1);
    segments.forEach((segment, index) => {
      const [x1, y1, x2, y2, x3, y3] = segment.split(' ').map(Number);
      expect([x3, y3]).toEqual(points[index + 1]);
      const [x0, y0] = points[index];
      expect(x1).toBeGreaterThanOrEqual(x0);
      expect(x2).toBeLessThanOrEqual(x3);
      for (let step = 0; step <= 20; step++) {
        const t = step / 20;
        const value =
          (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y3;
        expect(value).toBeGreaterThanOrEqual(Math.min(y0, y3) - 0.001);
        expect(value).toBeLessThanOrEqual(Math.max(y0, y3) + 0.001);
      }
    });
  });
  it('handles empty, single and two point series', () => {
    expect(smoothStatisticsPath([])).toBe('');
    expect(smoothStatisticsPath([[10, 20]])).toBe('M 10 20');
    expect(
      smoothStatisticsPath([
        [0, 0],
        [3, 3],
      ]),
    ).toBe('M 0 0 C 1 1 2 2 3 3');
  });
});
