import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CACHE_LIMIT_BYTES,
  cacheWatermarks,
  normalizeCacheLimitGiB,
} from '../src/utility/cache/cache-policy';

describe('cache capacity policy', () => {
  it('defaults to 10 GiB and accepts the supported 1-100 GiB range', () => {
    expect(DEFAULT_CACHE_LIMIT_BYTES).toBe(10 * 1024 ** 3);
    expect(normalizeCacheLimitGiB(undefined)).toBe(10);
    expect(normalizeCacheLimitGiB(1)).toBe(1);
    expect(normalizeCacheLimitGiB(100)).toBe(100);
  });

  it.each([0, -1, 0.5, 100.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an unsafe limit: %s',
    (value) => expect(() => normalizeCacheLimitGiB(value)).toThrow(),
  );

  it('uses 100%/90% high and low watermarks', () => {
    expect(cacheWatermarks(10)).toEqual({ highBytes: 10 * 1024 ** 3, lowBytes: 9 * 1024 ** 3 });
  });
});
