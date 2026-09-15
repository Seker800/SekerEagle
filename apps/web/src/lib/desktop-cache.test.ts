import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SekerDesktopBridge } from './media-resolver';
import { invalidateDesktopAssets, invalidateDesktopAssetsAndRefresh } from './desktop-cache';

describe('desktop cache invalidation', () => {
  afterEach(() => {
    delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
  });

  it('is a no-op on the web and deduplicates asset invalidations on desktop', async () => {
    await expect(invalidateDesktopAssets(['asset-a'])).resolves.toBeUndefined();
    const invalidateAsset = vi.fn().mockResolvedValue({ deleted: 1, deferred: 0 });
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      getCacheStatus: vi.fn(),
      setCacheLimitGiB: vi.fn(),
      clearCache: vi.fn(),
      invalidateAsset,
    };

    await invalidateDesktopAssets(['asset-a', 'asset-a', 'asset-b']);
    expect(invalidateAsset).toHaveBeenCalledTimes(2);
    expect(invalidateAsset).toHaveBeenCalledWith('asset-a');
    expect(invalidateAsset).toHaveBeenCalledWith('asset-b');
  });

  it('still refreshes private-sensitive UI when desktop invalidation fails', async () => {
    const failure = new Error('cache unavailable');
    const refresh = vi.fn().mockResolvedValue(undefined);
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      getCacheStatus: vi.fn(),
      setCacheLimitGiB: vi.fn(),
      clearCache: vi.fn(),
      invalidateAsset: vi.fn().mockRejectedValue(failure),
    };

    await expect(invalidateDesktopAssetsAndRefresh(['asset-a'], refresh)).rejects.toBe(failure);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
