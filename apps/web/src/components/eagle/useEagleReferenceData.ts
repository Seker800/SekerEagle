import { useProgressQueryInterval } from '../../lib/useRefreshPolicy';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { useQuery } from '@tanstack/react-query';

import type { createEagleQueryKeys } from './eagle-query-keys';

type EagleQueryKeys = ReturnType<typeof createEagleQueryKeys>;

export function useEagleReferenceData(
  accessToken: string,
  queryKeys: EagleQueryKeys,
  options: { aiTagsEnabled: boolean; enabled?: boolean },
) {
  const {
    api: { listEagleAiTags, listEagleManualTagGroups, listEagleManualTags, listEagleSmartFolders },
  } = useLibraryWorkspace();

  const manualTagsQuery = useQuery({
    queryKey: queryKeys.manualTags,
    queryFn: () => listEagleManualTags(accessToken),
    staleTime: 60_000,
    enabled: options.enabled,
  });
  const manualTagGroupsQuery = useQuery({
    queryKey: queryKeys.manualTagGroups,
    queryFn: () => listEagleManualTagGroups(accessToken),
    staleTime: 60_000,
    enabled: options.enabled,
  });
  const aiTagsQuery = useQuery({
    queryKey: queryKeys.aiTags,
    queryFn: () => listEagleAiTags(accessToken),
    staleTime: 60_000,
    enabled: options.enabled !== false && options.aiTagsEnabled,
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
    queryFn: () => listEagleSmartFolders(accessToken),
    staleTime: 60_000,
    enabled: options.enabled,
    refetchInterval: progressInterval,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { manualTagsQuery, manualTagGroupsQuery, aiTagsQuery, smartFoldersQuery };
}
