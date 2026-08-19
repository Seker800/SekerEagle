import { useRef } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { EagleFilterQuery } from '@sekereagle/eagle-filter-core';
import { mapWithConcurrency } from '../../lib/async-pool';
import {
  batchChangeEagleManualTags,
  batchUpdateEagleAssets,
  batchRestoreEagleAssets,
  batchSetEagleAssetPrivacy,
  batchTrashEagleAssets,
  createEagleManualTag,
  createEagleManualTagGroup,
  createEagleSmartFolder,
  deleteEagleManualTag,
  deleteEagleManualTagGroup,
  emptyEagleTrash,
  moveEagleSmartFolder,
  replaceEagleAssetManualTags,
  updateEagleAsset,
  updateEagleManualTag,
  updateEagleManualTagGroup,
  updateEagleSmartFolder,
  type EagleAsset,
  type EagleAssetChanges,
  type EagleAssetVersion,
  type EagleManualTag,
  type EagleManualTagGroup,
  type EagleSmartFolder,
} from '../../lib/eagle-api';
import type { MoveEagleSmartFolderInput } from './EagleSmartFolderTree';
import type { createEagleQueryKeys } from './eagle-query-keys';
import { moveSmartFolderInTree } from './eagle-smart-folder-order';

type EagleQueryKeys = ReturnType<typeof createEagleQueryKeys>;
type EagleAssetMetadataInput = Pick<EagleAssetChanges, 'displayName' | 'description' | 'sourceUrl'>;
type SmartFolderChanges = {
  name?: string;
  color?: string | null;
  query?: EagleFilterQuery;
};
type AssetMutationResult = { asset: EagleAsset | null; versions: EagleAssetVersion[] };

const EAGLE_ASSET_UPDATE_SCOPE = { id: 'eagle-asset-update' };

interface EagleMutationCallbacks {
  onMetadataSaved: (assetId: string, revision: number) => void;
  onBatchTagsApplied: () => void;
  onSelectionMutationCompleted: () => void;
  onSmartFolderCreated: () => void;
  onSmartFolderUpdated: (folder: EagleSmartFolder, changes: SmartFolderChanges) => void;
}

export function useEagleMutations(
  accessToken: string,
  queryKeys: EagleQueryKeys,
  callbacks: EagleMutationCallbacks,
) {
  const queryClient = useQueryClient();
  const invalidate = (...queryKeysToInvalidate: QueryKey[]) =>
    Promise.all(
      queryKeysToInvalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );

  const latestVersions = useRef(new Map<string, number>()).current;
  const withLatestVersions = (assets: EagleAssetVersion[]) =>
    assets.map((asset) => ({
      ...asset,
      rowVersion: Math.max(latestVersions.get(asset.assetId) ?? 0, asset.rowVersion),
    }));
  const rememberVersions = (assets: EagleAssetVersion[]) => {
    assets.forEach(({ assetId, rowVersion }) => {
      latestVersions.set(assetId, Math.max(latestVersions.get(assetId) ?? 0, rowVersion));
    });
  };

  const ratingMutation = useMutation({
    scope: EAGLE_ASSET_UPDATE_SCOPE,
    mutationFn: async ({
      assets,
      rating,
    }: {
      assets: EagleAssetVersion[];
      rating: number | null;
    }): Promise<AssetMutationResult> => {
      const targets = withLatestVersions(assets);
      if (targets.length === 1) {
        const [target] = targets;
        const asset = await updateEagleAsset(accessToken, target.assetId, {
          rating,
          rowVersion: target.rowVersion,
        });
        return { asset, versions: [{ assetId: asset.id, rowVersion: asset.rowVersion }] };
      }
      const result = await batchUpdateEagleAssets(accessToken, { assets: targets, rating });
      return { asset: null, versions: result.assets };
    },
    onSuccess: async ({ asset, versions }) => {
      rememberVersions(versions);
      if (asset) queryClient.setQueryData(queryKeys.assetDetail(asset.id), asset);
      await invalidate(queryKeys.assets);
    },
  });
  const metadataMutation = useMutation({
    scope: EAGLE_ASSET_UPDATE_SCOPE,
    mutationFn: async ({
      assetId: _assetId,
      assets,
      input,
    }: {
      assetId: string;
      assets: EagleAssetVersion[];
      input: EagleAssetMetadataInput;
      revision: number;
    }): Promise<AssetMutationResult> => {
      const targets = withLatestVersions(assets);
      if (targets.length === 1) {
        const [target] = targets;
        const asset = await updateEagleAsset(accessToken, target.assetId, {
          ...input,
          rowVersion: target.rowVersion,
        });
        return {
          asset,
          versions: [{ assetId: asset.id, rowVersion: asset.rowVersion }],
        };
      }
      const result = await batchUpdateEagleAssets(accessToken, { assets: targets, ...input });
      return { asset: null, versions: result.assets };
    },
    onSuccess: async ({ asset, versions }, variables) => {
      rememberVersions(versions);
      callbacks.onMetadataSaved(variables.assetId, variables.revision);
      if (asset) queryClient.setQueryData(queryKeys.assetDetail(asset.id), asset);
      await invalidate(queryKeys.assets, queryKeys.assetDetails);
    },
  });
  const replaceTagsMutation = useMutation({
    mutationFn: ({ assetId, tagIds }: { assetId: string; tagIds: string[] }) =>
      replaceEagleAssetManualTags(accessToken, assetId, tagIds),
    onSuccess: () => invalidate(queryKeys.assets, queryKeys.assetDetails, queryKeys.manualTags),
  });
  const createTagMutation = useMutation({
    mutationFn: (name: string) => createEagleManualTag(accessToken, { name }),
    onSuccess: () => invalidate(queryKeys.manualTags),
  });
  const createBatchTagMutation = useMutation({
    mutationFn: (name: string) => createEagleManualTag(accessToken, { name }),
    onSuccess: () => invalidate(queryKeys.manualTags),
  });
  const createTagGroupMutation = useMutation({
    mutationFn: (name: string) => createEagleManualTagGroup(accessToken, { name }),
    onSuccess: () => invalidate(queryKeys.manualTagGroups),
  });
  const updateTagsMutation = useMutation({
    mutationFn: ({
      tags,
      changes,
    }: {
      tags: EagleManualTag[];
      changes: {
        name?: string;
        color?: string | null;
        groupId?: string | null;
        isStarred?: boolean;
      };
    }) =>
      mapWithConcurrency(tags, 4, (tag) =>
        updateEagleManualTag(accessToken, tag.id, { ...changes, rowVersion: tag.rowVersion }),
      ),
    onSuccess: () =>
      invalidate(
        queryKeys.manualTags,
        queryKeys.manualTagGroups,
        queryKeys.assets,
        queryKeys.assetDetails,
      ),
  });
  const deleteTagsMutation = useMutation({
    mutationFn: (tags: EagleManualTag[]) =>
      mapWithConcurrency(tags, 4, (tag) => deleteEagleManualTag(accessToken, tag.id)),
    onSuccess: () =>
      invalidate(
        queryKeys.manualTags,
        queryKeys.manualTagGroups,
        queryKeys.assets,
        queryKeys.assetDetails,
      ),
  });
  const updateTagGroupMutation = useMutation({
    mutationFn: ({
      group,
      changes,
    }: {
      group: EagleManualTagGroup;
      changes: { name?: string; color?: string | null };
    }) =>
      updateEagleManualTagGroup(accessToken, group.id, {
        ...changes,
        rowVersion: group.rowVersion,
      }),
    onSuccess: () => invalidate(queryKeys.manualTagGroups),
  });
  const deleteTagGroupMutation = useMutation({
    mutationFn: (group: EagleManualTagGroup) => deleteEagleManualTagGroup(accessToken, group.id),
    onSuccess: () => invalidate(queryKeys.manualTags, queryKeys.manualTagGroups),
  });
  const batchTagMutation = useMutation({
    mutationFn: ({
      assetIds,
      addTagIds = [],
      removeTagIds = [],
    }: {
      assetIds: string[];
      addTagIds?: string[];
      removeTagIds?: string[];
    }) => batchChangeEagleManualTags(accessToken, { assetIds, addTagIds, removeTagIds }),
    onSuccess: async () => {
      callbacks.onBatchTagsApplied();
      await invalidate(queryKeys.assets, queryKeys.assetDetails, queryKeys.manualTags);
    },
  });
  const trashMutation = useMutation({
    mutationFn: (assetIds: string[]) => batchTrashEagleAssets(accessToken, assetIds),
    onSuccess: async () => {
      callbacks.onSelectionMutationCompleted();
      await invalidate(queryKeys.assets);
    },
  });
  const privacyMutation = useMutation({
    mutationFn: ({ assets, isPrivate }: { assets: EagleAssetVersion[]; isPrivate: boolean }) =>
      batchSetEagleAssetPrivacy(accessToken, {
        assets: withLatestVersions(assets),
        isPrivate,
      }),
    onSuccess: async ({ assets }) => {
      rememberVersions(assets);
      callbacks.onSelectionMutationCompleted();
      await invalidate(
        queryKeys.assets,
        queryKeys.assetDetails,
        queryKeys.manualTags,
        queryKeys.aiTags,
      );
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (assetIds: string[]) => batchRestoreEagleAssets(accessToken, assetIds),
    onSuccess: async () => {
      callbacks.onSelectionMutationCompleted();
      await invalidate(queryKeys.assets);
    },
  });
  const emptyTrashMutation = useMutation({
    mutationFn: () => emptyEagleTrash(accessToken),
    onSuccess: async () => {
      callbacks.onSelectionMutationCompleted();
      await invalidate(queryKeys.assets);
    },
  });
  const smartFolderMutation = useMutation({
    mutationFn: (input: { name: string; query: EagleFilterQuery }) =>
      createEagleSmartFolder(accessToken, input),
    onSuccess: async () => {
      callbacks.onSmartFolderCreated();
      await invalidate(queryKeys.smartFolders);
    },
  });
  const updateSmartFolderMutation = useMutation({
    mutationFn: ({ folder, changes }: { folder: EagleSmartFolder; changes: SmartFolderChanges }) =>
      updateEagleSmartFolder(accessToken, folder.id, { ...changes, rowVersion: folder.rowVersion }),
    onSuccess: async (_, { folder, changes }) => {
      callbacks.onSmartFolderUpdated(folder, changes);
      await invalidate(queryKeys.smartFolders, queryKeys.assets);
    },
  });
  const moveSmartFolderMutation = useMutation({
    mutationFn: ({
      folder,
      input,
    }: {
      folder: EagleSmartFolder;
      input: MoveEagleSmartFolderInput;
    }) => moveEagleSmartFolder(accessToken, folder.id, input),
    onMutate: async ({ folder, input }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.smartFolders });
      const previousFolders = queryClient.getQueryData<EagleSmartFolder[]>(queryKeys.smartFolders);
      if (previousFolders) {
        queryClient.setQueryData(
          queryKeys.smartFolders,
          moveSmartFolderInTree(previousFolders, folder.id, input),
        );
      }
      return { previousFolders };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousFolders) {
        queryClient.setQueryData(queryKeys.smartFolders, context.previousFolders);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.smartFolders });
    },
    onSuccess: (movedFolder) => {
      queryClient.setQueryData<EagleSmartFolder[]>(queryKeys.smartFolders, (folders) =>
        folders?.map((folder) => (folder.id === movedFolder.id ? movedFolder : folder)),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.smartFolders });
    },
  });

  return {
    ratingMutation,
    metadataMutation,
    replaceTagsMutation,
    createTagMutation,
    createBatchTagMutation,
    createTagGroupMutation,
    updateTagsMutation,
    deleteTagsMutation,
    updateTagGroupMutation,
    deleteTagGroupMutation,
    batchTagMutation,
    trashMutation,
    privacyMutation,
    restoreMutation,
    emptyTrashMutation,
    smartFolderMutation,
    updateSmartFolderMutation,
    moveSmartFolderMutation,
  };
}
