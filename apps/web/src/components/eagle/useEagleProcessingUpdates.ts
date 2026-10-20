import { useLibraryWorkspace } from '../../lib/library-workspace';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type EagleAssetListItem } from '../../lib/eagle-api';
import type { EagleAssetEntityStore } from './eagle-asset-entity-store';

export function getEagleProcessingPollInterval(
  visibility: DocumentVisibilityState,
  successfulSyncs: number,
): number | false {
  if (visibility === 'hidden') return false;
  return successfulSyncs < 3 ? 10_000 : 30_000;
}

/** Folded collections can contain unfinished items outside the rendered cover or loaded page. */
export function getEagleProcessingAssetIds(assets: readonly EagleAssetListItem[], additional: readonly string[] = []) {
  return [...new Set([...assets.filter((item) => item.lifecycleStatus === 'PROCESSING').map((item) => item.id), ...additional])].slice(0, 100);
}

export function useEagleProcessingUpdates(input: {
  accessToken: string;
  assets: EagleAssetListItem[];
  additionalProcessingAssetIds?: string[];
  enabled: boolean;
  assetStore: EagleAssetEntityStore;
  assetsQueryKey: QueryKey;
  updatesQueryKey: (assetIds: string[]) => QueryKey;
}) {
  const queryClient = useQueryClient();
  const {
    libraryMode,
    api: { listEagleAssetUpdates },
  } = useLibraryWorkspace();

  const [visibility, setVisibility] = useState<DocumentVisibilityState>(() =>
    typeof document === 'undefined' ? 'visible' : document.visibilityState,
  );
  useEffect(() => {
    const updateVisibility = () => setVisibility(document.visibilityState);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);
  const processingAssetIds = useMemo(
    () => getEagleProcessingAssetIds(input.assets, input.additionalProcessingAssetIds),
    [input.assets, input.additionalProcessingAssetIds],
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
    if (
      updates.some(
        (row) =>
          row.lifecycleStatus === 'READY' && (libraryMode === 'PHOTO' || row.livePhotoComponent),
      )
    )
      void queryClient.invalidateQueries({ queryKey: input.assetsQueryKey });
  }, [input.assetStore, input.assetsQueryKey, updatesQuery.data, libraryMode, queryClient]);
}
