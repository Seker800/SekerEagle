import { describe, expect, it } from 'vitest';
import { getEagleProcessingPollInterval } from './useEagleProcessingUpdates';

describe('getEagleProcessingPollInterval', () => {
  it('stops in hidden pages and backs off after the initial syncs', () => {
    expect(getEagleProcessingPollInterval('hidden', 0)).toBe(false);
    expect(getEagleProcessingPollInterval('visible', 0)).toBe(10_000);
    expect(getEagleProcessingPollInterval('visible', 2)).toBe(10_000);
    expect(getEagleProcessingPollInterval('visible', 3)).toBe(30_000);
  });
});
