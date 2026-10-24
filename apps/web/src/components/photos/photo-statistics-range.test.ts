import { describe, expect, it } from 'vitest';
import { statisticsDateRange } from './photo-statistics-range';
describe('calendar-year statistics ranges', () => {
  it('clamps leap-day anniversaries and includes the local current day', () => {
    const leapDay = new Date(2024, 1, 29, 0, 5);
    expect(statisticsDateRange(1, leapDay)).toEqual({ start: '2023-02-28', end: '2024-02-29' });
    expect(statisticsDateRange(3, leapDay)).toEqual({ start: '2021-02-28', end: '2024-02-29' });
    expect(statisticsDateRange('all', leapDay)).toEqual({ start: '', end: '' });
  });
});
