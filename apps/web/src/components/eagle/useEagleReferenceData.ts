import { useQuery } from '@tanstack/react-query';
import {
  listEagleAiTags,
  listEagleManualTagGroups,
  listEagleManualTags,
  listEagleSmartFolders,
} from '../../lib/eagle-api';
import type { createEagleQueryKeys } from './eagle-query-keys';

type EagleQueryKeys = ReturnType<typeof createEagleQueryKeys>;

export function useEagleReferenceData(accessToken: string, queryKeys: EagleQueryKeys) {
  const manualTagsQuery = useQuery({
    queryKey: queryKeys.manualTags,
    queryFn: () => listEagleManualTags(accessToken),
  });
  const manualTagGroupsQuery = useQuery({
    queryKey: queryKeys.manualTagGroups,
    queryFn: () => listEagleManualTagGroups(accessToken),
  });
  const aiTagsQuery = useQuery({
    queryKey: queryKeys.aiTags,
    queryFn: () => listEagleAiTags(accessToken),
  });
  const smartFoldersQuery = useQuery({
    queryKey: queryKeys.smartFolders,
    queryFn: () => listEagleSmartFolders(accessToken),
  });

  return { manualTagsQuery, manualTagGroupsQuery, aiTagsQuery, smartFoldersQuery };
}
