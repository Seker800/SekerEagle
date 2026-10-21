import { afterEach, expect, it } from 'vitest';
import {
  getPhotoTimelineMonth,
  getPhotoTimelineDay,
  createPhotoTimelineDayKeys,
  formatPhotoTimelineDay,
  createPhotoTimelineSectionKeys,
  formatPhotoTimelineMonth,
} from './photo-timeline-sections';
import i18next from 'i18next';

const date = { libraryAddedAt: '2026-10-19T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' };
afterEach(async () => {
  await i18next.changeLanguage('zh-CN');
});
it('uses the same canonical month as the rail, with capture and import fallbacks', () => {
  expect(getPhotoTimelineMonth({ ...date, chronologicalAt: '2024-03-01T00:30:00+08:00' })).toBe(
    '2024-02',
  );
  expect(
    getPhotoTimelineMonth({ ...date, photoMetadata: { capturedAt: '2023-02-02T00:00:00Z' } }),
  ).toBe('2023-02');
  expect(getPhotoTimelineMonth({ ...date, chronologicalAt: 'invalid' })).toBe('2026-10');
  expect(getPhotoTimelineMonth({ ...date, libraryAddedAt: 'invalid' })).toBe('2026-09');
  expect(getPhotoTimelineMonth({ libraryAddedAt: 'invalid', createdAt: '' })).toBeUndefined();
});
it('keeps one stable month key per asset without sorting or fabricating empty months', () => {
  const keys = createPhotoTimelineSectionKeys([
    { ...date, id: 'one' },
    { ...date, id: 'two' },
    { ...date, id: 'older', chronologicalAt: '2025-01-01T00:00:00Z' },
    { id: 'invalid', libraryAddedAt: '', createdAt: '' },
  ]);
  expect([...keys]).toEqual([
    ['one', '2026-10'],
    ['two', '2026-10'],
    ['older', '2025-01'],
  ]);
});
it('shows the full month and year in the selected display language', async () => {
  await i18next.changeLanguage('zh-CN');
  expect(formatPhotoTimelineMonth('2026-10')).toBe('2026年10月');
  await i18next.changeLanguage('en-US');
  expect(formatPhotoTimelineMonth('2026-10')).toBe('October 2026');
});

it('groups mobile dates by day while retaining canonical timestamps and fallback rules', () => {
  expect(getPhotoTimelineDay({ ...date, chronologicalAt: '2024-03-01T00:30:00+08:00' })).toBe(
    '2024-02-29',
  );
  expect(
    createPhotoTimelineDayKeys([
      { ...date, id: 'one' },
      { ...date, id: 'two', chronologicalAt: '2026-10-18T03:00:00Z' },
    ]),
  ).toEqual(
    new Map([
      ['one', '2026-10-19'],
      ['two', '2026-10-18'],
    ]),
  );
  expect(formatPhotoTimelineDay('2026-10-21')).toContain('21');
});
