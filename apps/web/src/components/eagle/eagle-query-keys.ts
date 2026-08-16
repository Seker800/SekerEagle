export function createEagleQueryKeys(ownerId: string) {
  const root = ['eagle', ownerId] as const;
  return {
    root,
    assets: [...root, 'assets'] as const,
    assetList: (view: string, filters: object) => [...root, 'assets', view, filters] as const,
    assetDetails: [...root, 'asset-detail'] as const,
    assetDetail: (assetId: string | null) => [...root, 'asset-detail', assetId] as const,
    assetUpdates: (assetIds: string[]) => [...root, 'asset-updates', assetIds] as const,
    manualTags: [...root, 'manual-tags'] as const,
    manualTagGroups: [...root, 'manual-tag-groups'] as const,
    aiTags: [...root, 'ai-tags'] as const,
    smartFolders: [...root, 'smart-folders'] as const,
  };
}
