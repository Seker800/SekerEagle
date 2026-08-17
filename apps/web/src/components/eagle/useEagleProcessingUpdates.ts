import { useEffect, useMemo, useState } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { listEagleAssetUpdates, type EagleAssetListItem } from '../../lib/eagle-api';
import type { EagleAssetEntityStore } from './eagle-asset-entity-store';

export function getEagleProcessingPollInterval(
  visibility: DocumentVisibilityState,
  successfulSyncs: number,
): number | false {
  if (visibility === 'hidden') return false;
  return successfulSyncs < 3 ? 10_000 : 30_000;
}

export function useEagleProcessingUpdates(input: {
  accessToken: string;
  assets: EagleAssetListItem[];
  enabled: boolean;
  assetStore: EagleAssetEntityStore;
  updatesQueryKey: (assetIds: string[]) => QueryKey;
}) {
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
    input.assetStore.mergeProcessingUpdates(updates);
  }, [input.assetStore, updatesQuery.data]);
}
