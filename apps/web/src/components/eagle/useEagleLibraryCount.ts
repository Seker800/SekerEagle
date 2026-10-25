import { EAGLE_FILTER_QUERY_VERSION } from '@sekereagle/eagle-filter-core';
import { useQuery } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { createEagleQueryKeys } from './eagle-query-keys';

/** The navigation badge counts originals, including members of collapsed photo groups. */
export function useEagleLibraryCount(
  accessToken: string,
  queryKeys: ReturnType<typeof createEagleQueryKeys>,
  privateVisible: boolean,
  privacyRevision: number,
  enabled = true,
) {
  const { api } = useLibraryWorkspace();
  return useQuery({
    queryKey: [...queryKeys.assets, 'library-count', privateVisible, privacyRevision],
    queryFn: () =>
      api.countEagleAssets(accessToken, { version: EAGLE_FILTER_QUERY_VERSION, conditions: [] }),
    staleTime: 30_000,
    enabled,
    refetchInterval: 30_000,
    select: (result) => result.count,
  });
}
