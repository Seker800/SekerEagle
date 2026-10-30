import type { QueryClient } from '@tanstack/react-query';
import { invalidateDesktopAssetsAndRefresh } from '../../lib/desktop-cache';
import type { createEagleQueryKeys } from './eagle-query-keys';

/** Tag relationship writes affect membership as well as the currently shown cards. */
export function refreshEagleAssetRelations(
  client: QueryClient,
  keys: ReturnType<typeof createEagleQueryKeys>,
  assetIds: readonly string[],
) {
  return invalidateDesktopAssetsAndRefresh(assetIds, () =>
    Promise.all(
      [
        keys.assets,
        keys.assetDetails,
        keys.manualTags,
        keys.manualTagGroups,
        keys.smartFolders,
        [...keys.root, 'vector-summary'],
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    ),
  );
}
