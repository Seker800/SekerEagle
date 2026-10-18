import type { EagleAssetListItem, EaglePhotoStack } from '../../lib/eagle-api';
/** Retains raw asset pagination; one stable cover represents a group across all loaded pages. */
export function collapsePhotoStacks(
  assets: readonly EagleAssetListItem[],
  stacks: readonly EaglePhotoStack[],
) {
  const membership = new Map<string, EaglePhotoStack>();
  for (const stack of stacks)
    if (stack.assetIds.length > 1)
      for (const id of stack.assetIds) if (!membership.has(id)) membership.set(id, stack);
  const seen = new Set<string>();
  return assets.flatMap((asset) => {
    const stack = membership.get(asset.id);
    const cover = stack?.cover ?? asset;
    const key = stack?.id ?? asset.id;
    if (seen.has(key)) return [];
    seen.add(key);
    return [cover];
  });
}
