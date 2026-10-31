import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
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
  const { api, ownerId, libraryMode } = useLibraryWorkspace();
  const client = useQueryClient();
  const changes = getEagleWorkspaceCache(client, ownerId, libraryMode).operations;
  useSyncExternalStore(changes.subscribe, changes.getSnapshot, changes.getSnapshot);
  const query = useQuery({
    queryKey: [...queryKeys.assets, 'library-count', privateVisible, privacyRevision],
    queryFn: () =>
      api.countEagleAssets(accessToken, { version: EAGLE_FILTER_QUERY_VERSION, conditions: [] }),
    staleTime: 60_000,
    enabled,
    select: (result) => changes.countOverride ?? result.count,
  });
  useEffect(() => {
    if (query.isSuccess && !query.isFetching) changes.confirmCounts();
  }, [changes, query.dataUpdatedAt, query.isSuccess, query.isFetching]);
  return query;
}
