export const GIBIBYTE = 1024 ** 3;
export const DEFAULT_CACHE_LIMIT_BYTES = 10 * GIBIBYTE;

export function normalizeCacheLimitGiB(value: number | undefined): number {
  const normalized = value ?? 10;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 100) {
    throw new Error('缓存上限必须是 1 到 100 GiB 的整数。');
  }
  return normalized;
}

export function cacheWatermarks(limitGiB: number): { highBytes: number; lowBytes: number } {
  const highBytes = normalizeCacheLimitGiB(limitGiB) * GIBIBYTE;
  return { highBytes, lowBytes: Math.floor(highBytes * 0.9) };
}
