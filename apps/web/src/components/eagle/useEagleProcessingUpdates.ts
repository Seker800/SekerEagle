import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import {
  listEagleAssetUpdates,
  type EagleAssetListItem,
  type EagleAssetUpdate,
} from '../../lib/eagle-api';

interface EagleAssetPage {
  items: EagleAssetListItem[];
  nextCursor: string | null;
  colorCoverage?: {
    eligible: number;
    completed: number;
    percentage: number;
    processorVersion: string;
  } | null;
}

export function getEagleProcessingPollInterval(
  visibility: DocumentVisibilityState,
  successfulSyncs: number,
): number | false {
  if (visibility === 'hidden') return false;
  return successfulSyncs < 3 ? 10_000 : 30_000;
}

function mergeEagleAssetUpdate(
  asset: EagleAssetListItem,
  update: EagleAssetUpdate,
): EagleAssetListItem {
  return {
    ...asset,
    lifecycleStatus: update.lifecycleStatus,
    mediaErrorCode: update.mediaErrorCode,
    updatedAt: update.updatedAt,
    renditions: update.renditions,
  };
}

export function useEagleProcessingUpdates(input: {
  accessToken: string;
  assets: EagleAssetListItem[];
  enabled: boolean;
  assetsQueryKey: QueryKey;
  updatesQueryKey: (assetIds: string[]) => QueryKey;
}) {
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<DocumentVisibilityState>(() =>
    typeof document === 'undefined' ? 'visible' : document.visibilityState,
  );
  useEffect(() => {
    const updateVisibility = () => setVisibility(document.visibilityState);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);
  const processingAssetIds = useMemo(
    () =>
      input.assets.filter((item) => item.lifecycleStatus === 'PROCESSING').map((item) => item.id),
    [input.assets],
  );
  const updatesQuery = useQuery({
    queryKey: input.updatesQueryKey(processingAssetIds),
    queryFn: ({ signal }) => listEagleAssetUpdates(input.accessToken, processingAssetIds, signal),
    enabled: input.enabled && visibility === 'visible' && processingAssetIds.length > 0,
    refetchInterval: (query) =>
      getEagleProcessingPollInterval(visibility, query.state.dataUpdateCount),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const updates = updatesQuery.data;
    if (!updates?.length) return;
    const updatesById = new Map(updates.map((item) => [item.id, item]));
    queryClient.setQueriesData<InfiniteData<EagleAssetPage>>(
      { queryKey: input.assetsQueryKey },
      (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((item) => {
                  const update = updatesById.get(item.id);
                  return update ? mergeEagleAssetUpdate(item, update) : item;
                }),
              })),
            }
          : current,
    );
  }, [input.assetsQueryKey, queryClient, updatesQuery.data]);
}
