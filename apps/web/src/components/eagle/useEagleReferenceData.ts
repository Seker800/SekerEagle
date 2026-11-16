import { useProgressQueryInterval } from '../../lib/useRefreshPolicy';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { useQuery } from '@tanstack/react-query';

import type { createEagleQueryKeys } from './eagle-query-keys';

type EagleQueryKeys = ReturnType<typeof createEagleQueryKeys>;

export function useEagleReferenceData(queryKeys: EagleQueryKeys, options: { enabled?: boolean }) {
  const {
    api: { listEagleManualTagGroups, listEagleManualTags, listEagleSmartFolders },
  } = useLibraryWorkspace();

  const manualTagsQuery = useQuery({
    queryKey: queryKeys.manualTags,
    queryFn: () => listEagleManualTags(),
    staleTime: 60_000,
    enabled: options.enabled,
  });
  const manualTagGroupsQuery = useQuery({
    queryKey: queryKeys.manualTagGroups,
    queryFn: () => listEagleManualTagGroups(),
    staleTime: 60_000,
    enabled: options.enabled,
  });
  const progressInterval = useProgressQueryInterval<
    Awaited<ReturnType<typeof listEagleSmartFolders>>
  >(
    (value) =>
      value.some(
        (folder) =>
          folder.semanticState?.status === 'PENDING' || folder.semanticState?.status === 'BUILDING',
      ),
    (value) => value.map((folder) => [folder.id, folder.semanticState]),
  );
  const smartFoldersQuery = useQuery({
    queryKey: queryKeys.smartFolders,
    queryFn: () => listEagleSmartFolders(),
    staleTime: 60_000,
    enabled: options.enabled,
    refetchInterval: progressInterval,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { manualTagsQuery, manualTagGroupsQuery, smartFoldersQuery };
}
