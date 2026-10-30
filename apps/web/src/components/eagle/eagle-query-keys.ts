export function createEagleQueryKeys(
  ownerId: string,
  libraryMode: 'MATERIAL' | 'PHOTO' = 'MATERIAL',
) {
  const root = ['eagle', ownerId, libraryMode] as const;
  return {
    root,
    assets: [...root, 'assets'] as const,
    assetList: (view: string, filters: object) => [...root, 'assets', view, filters] as const,
    assetDetails: [...root, 'asset-detail'] as const,
    assetDetailPrefix: (assetId: string | null) => [...root, 'asset-detail', assetId] as const,
    assetDetail: (assetId: string | null, view: string) =>
      [...root, 'asset-detail', assetId, view] as const,
    assetUpdates: (assetIds: string[]) => [...root, 'asset-updates', assetIds] as const,
    manualTags: [...root, 'manual-tags'] as const,
    manualTagGroups: [...root, 'manual-tag-groups'] as const,
    aiTags: [...root, 'ai-tags'] as const,
    smartFolders: [...root, 'smart-folders'] as const,
  };
}
