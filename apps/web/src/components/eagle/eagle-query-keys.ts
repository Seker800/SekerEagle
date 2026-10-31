export function createEagleQueryKeys(
  ownerId: string,
  libraryMode: 'MATERIAL' | 'PHOTO' = 'MATERIAL',
) {
  const root = ['eagle', ownerId, libraryMode] as const;
  return {
    root,
    assets: [...root, 'assets'] as const,
    libraryCounts: [...root, 'assets', 'library-count'] as const,
    libraryCount: (visible: boolean, revision: number) =>
      [...root, 'assets', 'library-count', visible, revision] as const,
    operations: [...root, 'operations'] as const,
    operationList: (visible: boolean) => [...root, 'operations', visible] as const,
    duplicates: [...root, 'duplicates'] as const,
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

/** Classify keys beside their constructors so receipt refreshes cannot guess tuple positions. */
export function isEagleQuery(key: readonly unknown[], ownerId: string, mode: string) {
  return key[0] === 'eagle' && key[1] === ownerId && key[2] === mode;
}
export function isEagleOperationKey(key: readonly unknown[], ownerId: string, mode: string) {
  return isEagleQuery(key, ownerId, mode) && key[3] === 'operations';
}
export function isEagleAssetListKey(key: readonly unknown[], ownerId: string, mode: string) {
  return (
    isEagleQuery(key, ownerId, mode) &&
    key.length === 6 &&
    key[3] === 'assets' &&
    ['ACTIVE', 'PRIVATE', 'TRASH'].includes(key[4] as string) &&
    key[5] !== null &&
    typeof key[5] === 'object' &&
    !Array.isArray(key[5])
  );
}
