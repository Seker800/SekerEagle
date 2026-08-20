import { getDesktopCacheBridge } from './media-resolver';

export async function invalidateDesktopAssets(assetIds: readonly string[]): Promise<void> {
  const bridge = getDesktopCacheBridge();
  if (!bridge) return;
  await Promise.all([...new Set(assetIds)].map((assetId) => bridge.invalidateAsset(assetId)));
}
