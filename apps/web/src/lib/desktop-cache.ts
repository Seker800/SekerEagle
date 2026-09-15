import { getDesktopCacheBridge } from './media-resolver';

export async function invalidateDesktopAssets(assetIds: readonly string[]): Promise<void> {
  const bridge = getDesktopCacheBridge();
  if (!bridge) return;
  await Promise.all([...new Set(assetIds)].map((assetId) => bridge.invalidateAsset(assetId)));
}

export async function invalidateDesktopAssetsAndRefresh(
  assetIds: readonly string[],
  refresh: () => Promise<unknown>,
): Promise<void> {
  const [cacheResult, refreshResult] = await Promise.allSettled([
    invalidateDesktopAssets(assetIds),
    refresh(),
  ]);
  if (refreshResult.status === 'rejected') throw refreshResult.reason;
  if (cacheResult.status === 'rejected') throw cacheResult.reason;
}
