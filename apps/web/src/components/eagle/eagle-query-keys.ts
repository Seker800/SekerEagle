export function createEagleQueryKeys(
  ownerId: string | null,
  libraryMode: 'MATERIAL' | 'PHOTO' = 'MATERIAL',
) {
  const root = ['eagle', ownerId, libraryMode] as const;
  return {
    owner: ['eagle', ownerId] as const,
    root,
    vectorSummary: [...root, 'vector-summary'] as const,
    pyramid: (assetId: string) => [...root, 'pyramid', assetId] as const,
    photoStatistics: (visible: boolean, input: object) =>
      [...root, 'statistics', visible, input] as const,
    photoAgent: (visible: boolean) => [...root, 'agent', visible] as const,
    photoAgentTasks: (visible: boolean) => [...root, 'agent', visible, 'tasks'] as const,
    photoAgentTask: (visible: boolean, id: string) =>
      [...root, 'agent', visible, 'task', id] as const,
    photoAgentHistory: (visible: boolean, id: string) =>
      [...root, 'agent', visible, 'history', id] as const,
    photoAgentInstructions: [...root, 'agent', 'instructions'] as const,
    photoPeople: [...root, 'people'] as const,
    photoPeopleDirectory: (visible: boolean, view: 'ALL' | 'NAMED' | 'UNNAMED') =>
      [...root, 'people', visible, view, view === 'ALL' ? 'cards-ranked-v2' : 'cards'] as const,
    photoPeopleMergeTargetRoot: [...root, 'people-merge-targets'] as const,
    photoPeopleSummary: [...root, 'people-summary'] as const,
    photoPeopleSummaryScope: (visible: boolean) => [...root, 'people-summary', visible] as const,
    photoPeopleOptions: (visible: boolean) => [...root, 'people', 'options', visible] as const,
    photoPeopleMergeTargets: (visible: boolean, revision: string) =>
      [...root, 'people-merge-targets', visible, revision] as const,
    photoPersonReview: [...root, 'person-review'] as const,
    photoPersonReviewScope: (visible: boolean, revision?: string) =>
      [...root, 'person-review', visible, revision, 'count-first-v3'] as const,
    photoPersonFaces: [...root, 'person-faces'] as const,
    photoPersonFaceList: (visible: boolean, id: string) =>
      [...root, 'person-faces', visible, id] as const,
    photoFacets: (visible: boolean) => [...root, 'photography-facets', visible] as const,
    photoMap: (visible: boolean, viewport: object) => [...root, 'map', visible, viewport] as const,
    photoMapPhotos: (visible: boolean, cell: string, cursor?: string) =>
      [...root, 'map-photos', visible, cell, cursor] as const,
    photoStackAsset: (id: string) => [...root, 'stack-asset', id] as const,
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

/** Privacy position belongs to each resource's key protocol, never its consumers. */
export function photoQueryVisibility(
  key: readonly unknown[],
  ownerId: string | null,
): boolean | undefined {
  if (key[0] !== 'eagle' || key[1] !== ownerId || key[2] !== 'PHOTO') return undefined;
  const visibility = key[3] === 'people' && key[4] === 'options' ? key[5] : key[4];
  return typeof visibility === 'boolean' ? visibility : undefined;
}
export function isPhotoPeopleProjection(key: readonly unknown[], ownerId: string | null) {
  return (
    key[0] === 'eagle' &&
    key[1] === ownerId &&
    key[2] === 'PHOTO' &&
    (key[3] === 'people' || key[3] === 'people-merge-targets') &&
    photoQueryVisibility(key, ownerId) !== undefined
  );
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
