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
  const smartFoldersQuery = useQuery({
    queryKey: queryKeys.smartFolders,
    queryFn: () => listEagleSmartFolders(accessToken),
    staleTime: 60_000,
    enabled: options.enabled,
    refetchInterval: (query) =>
      query.state.data?.some(
        (folder) =>
          folder.semanticState?.status === 'PENDING' || folder.semanticState?.status === 'BUILDING',
      )
        ? 10_000
        : 60_000,
  });

  return { manualTagsQuery, manualTagGroupsQuery, aiTagsQuery, smartFoldersQuery };
}
