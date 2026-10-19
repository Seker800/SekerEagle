import type * as I18n from '../../i18n';
import { expect, it, vi } from 'vitest';
import { EAGLE_FILTER_FIELDS } from '@sekereagle/eagle-filter-core';
vi.mock('../../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18n>();
  return {
    ...actual,
    t: (id: Parameters<typeof actual.t>[0], options?: Parameters<typeof actual.t>[1]) =>
      actual.tForLocale('en-US', id, options),
  };
});
import { getFilterPresentation, getOperatorLabel } from './eagle-filter-presentation';
it('keeps the rule catalog language independent and renders English fields, operators, options and units', () => {
  expect(JSON.stringify(EAGLE_FILTER_FIELDS)).not.toMatch(/\p{Script=Han}/u);
  expect(getFilterPresentation('CAMERA_MODEL').label).toBe('Camera');
  expect(getFilterPresentation('NAME').label).toBe('Name');
  expect(getOperatorLabel('CONTAINS')).toBe('Contains');
  expect(getFilterPresentation('RATING').options?.[0].label).toBe('Unrated');
  expect(getFilterPresentation('DURATION').units?.[0].label).toBe('seconds');
});
