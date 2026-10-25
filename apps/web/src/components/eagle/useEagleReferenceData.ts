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
    enabled: options.enabled,
  });
  const manualTagGroupsQuery = useQuery({
    queryKey: queryKeys.manualTagGroups,
    queryFn: () => listEagleManualTagGroups(accessToken),
    enabled: options.enabled,
  });
  const aiTagsQuery = useQuery({
    queryKey: queryKeys.aiTags,
    queryFn: () => listEagleAiTags(accessToken),
    enabled: options.enabled !== false && options.aiTagsEnabled,
  });
  const smartFoldersQuery = useQuery({
    queryKey: queryKeys.smartFolders,
    queryFn: () => listEagleSmartFolders(accessToken),
    enabled: options.enabled,
    refetchInterval: (query) =>
      query.state.data?.some((folder) => folder.semanticState) ? 10_000 : false,
  });

  return { manualTagsQuery, manualTagGroupsQuery, aiTagsQuery, smartFoldersQuery };
}
