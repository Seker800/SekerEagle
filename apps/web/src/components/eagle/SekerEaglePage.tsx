import { EagleTrashConfirmation } from './EagleTrashConfirmation';
import { EagleConfirmationDialog } from './EagleConfirmationDialog';
import { mediaProcessingFailure } from '../../lib/media-processing-error';
import { awaitWorkspaceRefreshBaseline } from '../../lib/workspace-refresh';
import { EagleOperationNotices } from './EagleOperationNotices';
import { EagleDuplicates } from './EagleDuplicates';
import { refreshEagleAssetRelations } from './eagle-write-refresh';
import { EagleUploadQueue } from './EagleUploadQueue';
import { AsyncViewBoundary } from '../AsyncViewBoundary';
import { useAssetOperationProgress } from './useAssetOperations';
import { EagleFavoriteButton } from './EagleFavoriteButton';
import { IconChartBar } from '@tabler/icons-react';
import { EagleSmartFolderStatus } from './EagleSmartFolderStatus';
import { useEaglePrependAnchor } from './useEaglePrependAnchor';
import { useEagleLibraryCount } from './useEagleLibraryCount';
import { useMobileBack } from '../../lib/mobile-back';
import { EagleMobileSearch } from './EagleMobileSearch';
import {
  EagleMobileChrome,
  EagleMobileNavigation,
  type MobileDestination,
} from './EagleMobileChrome';
import { EagleMobileMore, isAndroidClient } from './EagleMobileMore';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { EagleResponsiveTools } from './EagleResponsiveTools';
import { EagleResponsiveDetails } from './EagleResponsiveDetails';
import { EagleAssetCard, type AssetCardActions } from './EagleAssetCard';
import { eagleViewerMetadata } from './EagleViewerShell';
import { EagleAssetActionMenu } from './EagleAssetActionMenu';
import { EagleLibraryNavigation } from './EagleLibraryNavigation';
import { EagleImportButton } from './EagleImportButton';
import { EagleSelectionToolbar } from './EagleSelectionToolbar';
import { useEaglePreviewNavigation } from './useEaglePreviewNavigation';
import {
  createPhotoTimelineSectionKeys,
  createPhotoTimelineDayKeys,
  formatPhotoTimelineDay,
  formatPhotoTimelineMonth,
  getPhotoTimelineMonth,
} from '../photos/photo-timeline-sections';
import { EagleSendAssetsMenuItem } from './EagleSendAssetsMenuItem';
import type { EaglePhotoStack } from '../../lib/eagle-api';
import { collapsePhotoStacks } from '../photos/photo-stacks';
import { PhotoStackLightbox } from '../photos/PhotoStackLightbox';
import { usePhotoFilterOptions } from '../photos/usePhotoFilterOptions';
import { PhotoCollections } from '../photos/PhotoCollections';
import { PhotoTimelineRail } from '../photos/PhotoTimelineRail';
import { usePhotoTimeline } from '../photos/usePhotoTimeline';
import { PhotoMetadataDetails } from '../photos/PhotoMetadataDetails';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getLocale, t } from '../../i18n';
import {
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  hashKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { readEagleSemanticIntent, toEagleFilterQuery } from '@sekereagle/eagle-filter-core';
import {
  IconCheck,
  IconCopy,
  IconFilter,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconLayoutGrid,
  IconLayoutSidebarRight,
  IconLoader2,
  IconLock,
  IconPhoto,
  IconMapPin,
  IconUsers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconTagsOff,
  IconTags,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import sekerEagleLogo from '../../assets/seker-eagle-logo.svg';
import { useEagleAssetPreview } from './useEagleAssetPreview';
import { useEagleBrowseSession } from './useEagleBrowseSession';
import {
  type EagleAsset,
  type EagleAssetListItem,
  type EagleAssetFilters,
  type EagleAssetVersion,
  type EagleManualTag,
  type EagleSmartFolder,
} from '../../lib/eagle-api';
import type { PrivacyVisibilityState } from '../../lib/privacy-visibility-api';
import { canCopyImageToClipboard } from '../../lib/image-clipboard';
import { EagleDownloadQueue } from './EagleDownloadQueue';

import { EagleAssetLightbox } from './EagleAssetLightbox';
import {
  EagleEditPhotoButton,
  EaglePhotoEditorDialog,
  eaglePhotoEditLabel,
  useEaglePhotoEditing,
} from './EaglePhotoEditing';
import { EagleImageViewer, preloadEagleImageViewer } from './EagleImageViewer';
import { useEagleAssetLocation, useEagleAssetLocationFocus } from './useEagleAssetLocation';
import { useEagleAssetViewport } from './eagle-asset-viewport';
import { CachedEagleAssetThumbnail } from './EagleAssetThumbnail';
import {
  getEaglePreviewContentUrl,
  getEagleEditContentUrl,
  getEagleLivePhotoContentUrl,
  collapseLivePhotoComponents,
  needsEagleImagePyramid,
  eaglePreviewIsLimited,
  getEagleViewerHighResolutionUrl,
} from './eagle-media-sources';
import { EagleBatchTagPicker } from './EagleBatchTagPicker';
import { EagleColorPalette } from './EagleColorPalette';
import type { EagleVectorWorkspaceView } from './EagleVectorWorkspace';
import { EagleSmartFolderDialog } from './EagleSmartFolderDialog';
import { EagleSmartFolderTree } from './EagleSmartFolderTree';
import {
  EagleQuickFilterBar,
  buildEagleQuickFilterQuery,
  createEmptyEagleQuickFilterState,
} from './EagleQuickFilterBar';
import { EagleTagPage } from './EagleTagPage';
import { useEagleMasonryLayout } from './eagle-masonry-layout';
import type { EagleSelectionGesture } from './eagle-selection';
import { useEagleMetadataDraft } from './useEagleMetadataDraft';
import { useEagleSelectionController } from './useEagleSelectionController';
import { isFileDrag } from './eagle-asset-drag';
import { useEagleAssetTransferActions } from './useEagleAssetTransferActions';
import type { NormalizedEagleAssetPage } from './eagle-asset-entity-store';
import {
  getEagleWorkspaceCache,
  type EagleLibraryView,
  type EaglePhotoView,
} from './eagle-workspace-cache';
import { createEagleQueryKeys } from './eagle-query-keys';
import { useEagleUploadController } from './useEagleUploadController';
import { useEagleReferenceData } from './useEagleReferenceData';
import { useEagleProcessingUpdates } from './useEagleProcessingUpdates';
import { useEagleMutations } from './useEagleMutations';
import {
  buildMasonryViewportIndex,
  selectVisibleMasonryItemsFromIndex,
} from '../media/masonry-layout';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import styles from './SekerEaglePage.module.css';
const PhotoStatistics = lazy(() =>
  import('../photos/PhotoStatistics').then((module) => ({ default: module.PhotoStatistics })),
);
const PhotoAgentReview = lazy(() =>
  import('../photos/PhotoAgentReview').then((module) => ({ default: module.PhotoAgentReview })),
);
const EagleTaskCenter = lazy(() =>
  import('./EagleTaskCenter').then((module) => ({ default: module.EagleTaskCenter })),
);
const EagleVectorWorkspace = lazy(() =>
  import('./EagleVectorWorkspace').then((module) => ({ default: module.EagleVectorWorkspace })),
);
const PhotoMap = lazy(() =>
  import('../photos/PhotoMap').then((module) => ({ default: module.PhotoMap })),
);
const EagleBatchPhotoEdit = lazy(() =>
  import('./EagleBatchPhotoEdit').then((module) => ({ default: module.EagleBatchPhotoEdit })),
);

interface SekerEaglePageProps {
  modeSwitcher?: ReactNode;
  ownerId: string;
  canManageProcessing?: boolean;
  accountView?: ReactNode;
  accountSummary?: { email: string; onLogout: () => void };
  privacyVisibility?: PrivacyVisibilityState;
  privacyRulesRevision?: number;
  onPrivacyRulesChange?: () => void;
}
type EagleTagPickerState = {
  mode: 'add' | 'remove';
  assetIds: string[];
};
function getVectorWorkspaceView(view: EagleLibraryView): EagleVectorWorkspaceView | null {
  if (view === 'VECTOR_REVIEW') return 'REVIEW';
  if (view === 'VECTOR_TAGS') return 'TAGS';
  if (view === 'VECTOR_UNCLASSIFIED') return 'UNCLASSIFIED';
  return null;
}

interface EagleWorkspaceNavigationProps {
  title: string;
  ariaLabel: string;
  layout?: 'tabs' | 'sidebar';
  activeView: EagleLibraryView;
  items: Array<{ view: EagleLibraryView; label: string; count?: number }>;
  onSelect: (view: EagleLibraryView) => void;
}

function EagleWorkspaceNavigation({
  title,
  ariaLabel,
  layout = 'tabs',
  activeView,
  items,
  onSelect,
}: EagleWorkspaceNavigationProps) {
  return (
    <header className={styles.workspaceNavigation} data-layout={layout}>
      <h1>{title}</h1>
      <nav aria-label={ariaLabel}>
        {items.map((item) => {
          const accessibleLabel =
            item.count === undefined ? item.label : `${item.label} ${item.count}`;
          return (
            <button
              key={item.view}
              type="button"
              className={activeView === item.view ? styles.workspaceNavigationActive : undefined}
              aria-label={accessibleLabel}
              aria-current={activeView === item.view ? 'page' : undefined}
              onClick={() => onSelect(item.view)}
            >
              {item.label}
              {item.count === undefined ? null : <span>{item.count}</span>}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
const EAGLE_PAGE_SIZE = 40;
const ASSET_LIST_STALE_TIME_MS = 5 * 60000;
const ASSET_LIST_GC_TIME_MS = 30 * 60000;
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
export function SekerEaglePage({
  modeSwitcher,
  ownerId,
  canManageProcessing = false,
  accountView,
  accountSummary,
  privacyVisibility,
  privacyRulesRevision = 0,
  onPrivacyRulesChange,
}: SekerEaglePageProps) {
  const { libraryMode } = useLibraryWorkspace();
  const storeScope = JSON.stringify([ownerId, libraryMode]);
  const {
    api: {
      getEagleAsset,
      getEagleAssetLocation,
      getEagleTrashAsset,
      getEaglePyramidDescriptor,
      listEagleAssets,
      listEagleTrash,
      fetchEagleReviewSummary,
      retryEagleAssetProcessing,
    },
  } = useLibraryWorkspace();

  const queryClient = useQueryClient();
  const privateVisible = privacyVisibility?.enabled === true;
  const queryKeys = useMemo(() => {
    if (!ownerId) throw new Error('SekerEagle requires an authenticated owner identity.');
    return createEagleQueryKeys(ownerId, libraryMode);
  }, [ownerId, libraryMode]);
  const thumbnailScheduler = useMemo(() => new MediaLoadScheduler(), [ownerId]);
  const workspaceCache = useMemo(
    () => getEagleWorkspaceCache(queryClient, ownerId, libraryMode),
    [queryClient, ownerId, libraryMode],
  );
  const operationRevision = useSyncExternalStore(
    workspaceCache.operations.subscribe,
    workspaceCache.operations.getSnapshot,
    workspaceCache.operations.getSnapshot,
  );
  const thumbnailLoadService = workspaceCache.thumbnails;
  const pageSentinelRef = useRef<HTMLDivElement>(null);
  const privacyStateRef = useRef(
    `${privacyVisibility?.enabled === true}:${privacyVisibility?.expiresAt ?? ''}:${privacyRulesRevision}`,
  );
  const metadataFormRef = useRef<HTMLFormElement>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [isSmartFolderDialogOpen, setIsSmartFolderDialogOpen] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<EagleSmartFolder | null>(null);
  const compact = useCompactLayout();
  const [mobileMore, setMobileMore] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const selection = useEagleSelectionController(
    !privateVisible ? (workspaceCache.browse ?? {}) : {},
  );
  const {
    selectedAssetIds,
    selectedAssetId,
    isBatchSelection,
    selectionMode,
    assetContextMenu,
    setSelectionMode,
    setAssetContextMenu,
    clear: clearAssetSelection,
  } = selection;
  const [tagPicker, setTagPicker] = useState<EagleTagPickerState | null>(null);
  const {
    photoView,
    setPhotoView,
    search,
    setSearch,
    libraryView,
    setLibraryView,
    smartFolderOrder,
    setSmartFolderOrder,
    activeSmartFolderId,
    setActiveSmartFolderId,
    setFilterResetKey,
    quickFilters,
    setQuickFilters,
    deferredSearch,
    deferredQuickFilters,
    filterInputsPending,
    filtersExpanded,
    setFiltersExpanded,
    filterPanelId,
    isInspectorVisible,
    setIsInspectorVisible,
    timelineCursor,
    setTimelineCursor,
    thumbnailSize,
    setThumbnailSize,
    activeFilterCount,
    appliedFilterCount,
    filterQuery,
    workspaceSection,
    isAssetView,
    showsAssetControls,
    isPhotoTimeline,
    hasTimelineNavigation,
  } = useEagleBrowseSession({
    ownerId,
    libraryMode,
    privateVisible,
    compact,
    privacyRulesRevision,
    workspaceCache,
    selection,
  });
  const [failedAssetAction, setFailedAssetAction] = useState<EagleAssetListItem | null>(null);
  const [failedAssetError, setFailedAssetError] = useState<string | null>(null);
  const editingScope = `${storeScope}:${privateVisible}:${privacyVisibility?.expiresAt ?? ''}:${privacyRulesRevision}`;
  const metadataDraft = useEagleMetadataDraft(editingScope);
  const imagePreview = useEagleAssetPreview(editingScope);
  const previewAssetId = imagePreview.assetId;
  const photoEditing = useEaglePhotoEditing({
    ownerId,
    scopeKey: editingScope,
  });
  const [batchEditIds, setBatchEditIds] = useState<string[] | null>(null);
  useEffect(() => setBatchEditIds(null), [editingScope]);
  const openPhotoEditor = (asset: EagleAssetListItem) => {
    setAssetContextMenu(null);
    photoEditing.open(asset);
  };
  const {
    importFiles,
    uploads,
    summary: uploadSummary,
    pauseUploads,
    resumeUploads,
    retryAllFailed,
    dismissUploads,
    retryUpload,
  } = useEagleUploadController(queryKeys.assets);
  const assetLocator = useEagleAssetLocation({
    getLocation: getEagleAssetLocation,
    scopeKey: `${storeScope}:${privateVisible}:${privacyRulesRevision}`,
    onLocated: () => {
      setSearch('');
      setQuickFilters(createEmptyEagleQuickFilterState());
      setActiveSmartFolderId(null);
      setLibraryView('ACTIVE');
      setPhotoView('timeline');
      setTimelineCursor('');
      imagePreview.closePreview();
      setAssetContextMenu(null);
    },
  });
  const hasAssetLocation =
    libraryView === 'ACTIVE' &&
    !deferredSearch &&
    !activeFilterCount &&
    !activeSmartFolderId &&
    (libraryMode !== 'PHOTO' || photoView === 'timeline');
  const browserCursor =
    hasAssetLocation && assetLocator.location
      ? (assetLocator.location.cursor ?? '')
      : hasTimelineNavigation
        ? timelineCursor
        : '';
  useEffect(() => {
    if (
      search ||
      activeFilterCount ||
      activeSmartFolderId ||
      libraryView !== 'ACTIVE' ||
      (libraryMode === 'PHOTO' && photoView !== 'timeline')
    )
      assetLocator.clearLocation();
  }, [
    search,
    activeFilterCount,
    activeSmartFolderId,
    libraryView,
    libraryMode,
    photoView,
    assetLocator.clearLocation,
  ]);

  const timelineIndex = usePhotoTimeline(
    hasTimelineNavigation,
    queryKeys.assets,
    privateVisible,
    privacyRulesRevision,
  );
  const assetFilters: EagleAssetFilters = {
    cursor: browserCursor || undefined,
    limit: EAGLE_PAGE_SIZE,
    search: deferredSearch || undefined,
    rules: appliedFilterCount ? filterQuery : undefined,
    smartFolderId: activeSmartFolderId ?? undefined,
    smartFolderOrder:
      activeSmartFolderId && smartFolderOrder === 'RELEVANCE' ? 'RELEVANCE' : undefined,
    privacy: libraryView === 'PRIVATE' ? 'PRIVATE' : undefined,
  };
  const listKey = queryKeys.assetList(libraryView, assetFilters);
  const visibilityScope = `${privateVisible}:${privacyVisibility?.expiresAt ?? ''}:${privacyRulesRevision}`;
  const assetViewport = useEagleAssetViewport(hashKey(listKey), workspaceCache.scrollPositions);
  const assetViewportRef = assetViewport.elementRef;
  const { scrollTop, viewportHeight } = assetViewport;
  const assetStore = workspaceCache.store;
  useEffect(() => workspaceCache.retain(privateVisible), [workspaceCache, privateVisible]);
  const assetStoreRevision = useSyncExternalStore(
    assetStore.subscribe,
    assetStore.getSnapshot,
    assetStore.getSnapshot,
  );
  const assetsQuery = useInfiniteQuery({
    queryKey: listKey,
    meta: { visibilityScope },
    placeholderData: (
      previous: InfiniteData<NormalizedEagleAssetPage, string> | undefined,
      query,
    ) => {
      if (privateVisible || query?.meta?.visibilityScope !== visibilityScope) return undefined;
      const previousKey = query?.queryKey;
      return previousKey && previousKey.slice(0, 5).every((part, index) => part === listKey[index])
        ? previous
        : undefined;
    },
    queryFn: async ({ pageParam, signal }) => {
      const baseline = awaitWorkspaceRefreshBaseline(
        queryClient,
        ownerId,
        privateVisible,
        listKey,
        signal,
      );
      if (baseline) await baseline;
      signal.throwIfAborted();
      const membershipRevision = workspaceCache.operations.getSnapshot();
      const pageFilters = { ...assetFilters, cursor: pageParam || undefined };
      const page =
        libraryView === 'TRASH'
          ? await listEagleTrash(pageFilters, signal)
          : await listEagleAssets(pageFilters, signal);
      signal.throwIfAborted();
      workspaceCache.operations.observePage(
        page.items,
        libraryView === 'TRASH',
        membershipRevision,
      );
      return assetStore.normalizePage(page);
    },
    initialPageParam: browserCursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    getPreviousPageParam: (firstPage) => firstPage.previousCursor ?? undefined,
    enabled: isAssetView && showsAssetControls && !filterInputsPending,
    staleTime: ASSET_LIST_STALE_TIME_MS,
    gcTime: ASSET_LIST_GC_TIME_MS,
  });
  const listIdentity = hashKey(listKey);
  const loadingNewResults = assetsQuery.isFetching && assetsQuery.isPlaceholderData;
  const [loadingFeedbackKey, setLoadingFeedbackKey] = useState<string | null>(null);
  useEffect(() => {
    if (!loadingNewResults) {
      setLoadingFeedbackKey(null);
      return;
    }
    // Delay only feedback; the query starts immediately and cached results stay visible.
    const timeout = window.setTimeout(() => setLoadingFeedbackKey(listIdentity), 200);
    return () => window.clearTimeout(timeout);
  }, [loadingNewResults, listIdentity]);
  const showLoadingFeedback = loadingNewResults && loadingFeedbackKey === listIdentity;
  const selectionScope = hashKey([listIdentity, quickFilters, search]);
  const previousSelectionScope = useRef(selectionScope);
  useEffect(() => {
    if (previousSelectionScope.current === selectionScope) return;
    previousSelectionScope.current = selectionScope;
    clearAssetSelection({ preserveMode: true });
  }, [selectionScope]);
  const { manualTagsQuery, manualTagGroupsQuery, smartFoldersQuery } = useEagleReferenceData(
    queryKeys,
    { enabled: true },
  );
  useAssetOperationProgress(privateVisible, true);
  const vectorSummaryQuery = useQuery({
    queryKey: queryKeys.vectorSummary,
    queryFn: fetchEagleReviewSummary,
    staleTime: 60_000,
    enabled: true,
  });
  const vectorSummary = vectorSummaryQuery.data;
  const unavailableSuggestionCount = Math.max(
    0,
    (vectorSummary?.suggestions.unclassified ?? 0) - (vectorSummary?.suggestions.pending ?? 0),
  );
  const pendingWorkCount = unavailableSuggestionCount + (vectorSummary?.suggestions.pending ?? 0);
  const photoFieldOptions = usePhotoFilterOptions(
    privateVisible,
    (isAssetView && showsAssetControls && filtersExpanded) || isSmartFolderDialogOpen,
  );
  const resetAssetPrivacyState = useCallback(() => {
    workspaceCache.clearNavigation();
    thumbnailScheduler.clear({ abortActive: true });
    thumbnailLoadService.dispose();
    assetStore.clear();
    imagePreview.closePreview();
    clearAssetSelection();
    void queryClient.resetQueries({ queryKey: queryKeys.root });
  }, [
    workspaceCache,
    assetStore,
    imagePreview,
    queryClient,
    queryKeys.root,
    thumbnailLoadService,
    thumbnailScheduler,
  ]);
  const {
    ratingMutation,
    metadataMutation,
    createTagMutation,
    createBatchTagMutation,
    createTagGroupMutation,
    tagBatchFailure,
    updateTagsMutation,
    deleteTagsMutation,
    updateTagGroupMutation,
    deleteTagGroupMutation,
    batchTagMutation,
    trashMutation,
    restoreMutation,
    emptyTrashMutation,
    smartFolderMutation,
    updateSmartFolderMutation,
    deleteSmartFolderMutation,
    moveSmartFolderMutation,
  } = useEagleMutations(queryKeys, {
    onMetadataSaved: metadataDraft.saved,
    onBatchTagsApplied: () => setTagPicker(null),
    onAssetPrivacyChanged: resetAssetPrivacyState,
    onOperationStarted: () => {
      imagePreview.closePreview();
      clearAssetSelection();
    },
    onSmartFolderCreated: () => setIsSmartFolderDialogOpen(false),
    onSmartFolderUpdated: (folder, changes) => {
      setIsSmartFolderDialogOpen(false);
      setEditingSmartFolder(null);
      if (activeSmartFolderId !== folder.id || changes.name === undefined) return;
      setSearch('');
      setQuickFilters(createEmptyEagleQuickFilterState());
    },
    onSmartFolderDeleted: (folder) => {
      if (activeSmartFolderId === folder.id) navigateLibrary({ view: 'ACTIVE' });
    },
  });
  const retryAssetProcessingMutation = useMutation({
    mutationFn: (assetId: string) => retryEagleAssetProcessing(assetId),
    onSuccess: async () => {
      setFailedAssetAction(null);
      setFailedAssetError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryCounts });
    },
    onError: (error) => setFailedAssetError(error instanceof Error ? error.message : t('操作失败')),
  });
  const handleAssetProcessingActions = (asset: EagleAssetListItem) => {
    setAssetContextMenu(null);
    setFailedAssetError(null);
    setFailedAssetAction(asset);
  };
  const loadedAssets = useMemo(() => {
    const uniqueAssets = new Map<string, EagleAssetListItem>();
    assetsQuery.data?.pages.forEach((page) => {
      assetStore.getMany(page.assetIds).forEach((item) => {
        if (workspaceCache.operations.visible(item.id, libraryView === 'TRASH'))
          uniqueAssets.set(item.id, item);
      });
    });
    return [...uniqueAssets.values()];
  }, [
    assetStore,
    assetStoreRevision,
    assetsQuery.data,
    workspaceCache,
    operationRevision,
    libraryView,
  ]);
  useEffect(() => {
    const nextPrivacyState = `${privateVisible}:${privacyVisibility?.expiresAt ?? ''}:${privacyRulesRevision}`;
    if (privacyStateRef.current === nextPrivacyState) return;
    privacyStateRef.current = nextPrivacyState;
    resetAssetPrivacyState();
    if (!privateVisible && libraryView === 'PRIVATE') setLibraryView('ACTIVE');
  }, [
    libraryView,
    privateVisible,
    privacyVisibility?.expiresAt,
    privacyRulesRevision,
    resetAssetPrivacyState,
  ]);
  const libraryCount = useEagleLibraryCount(queryKeys, privateVisible, privacyRulesRevision, true);
  const photoStacks = useMemo(() => {
    const stacks = new Map<string, EaglePhotoStack>();
    for (const page of assetsQuery.data?.pages ?? [])
      for (const stack of page.photoStacks ?? []) stacks.set(stack.id, stack);
    return [...stacks.values()].flatMap((stack) => {
      const assetIds = stack.assetIds.filter((id) => workspaceCache.operations.visible(id, false));
      if (assetIds.length < 2) return [];
      const cover = workspaceCache.operations.visible(stack.cover.id, false)
        ? stack.cover
        : assetStore.getMany(assetIds)[0];
      return cover ? [{ ...stack, assetIds, cover }] : [];
    });
  }, [assetsQuery.data, workspaceCache, assetStore, operationRevision, assetStoreRevision]);
  const photoStacksByCover = useMemo(
    () => new Map(photoStacks.map((stack) => [stack.cover.id, stack])),
    [photoStacks],
  );
  const photoStacksByAsset = useMemo(() => {
    const map = new Map<string, (typeof photoStacks)[number]>();
    for (const stack of photoStacks) for (const id of stack.assetIds) map.set(id, stack);
    return map;
  }, [photoStacks]);
  const assets = useMemo(
    () =>
      libraryMode === 'PHOTO' && photoView === 'timeline' && libraryView !== 'TRASH'
        ? collapseLivePhotoComponents(collapsePhotoStacks(loadedAssets, photoStacks), loadedAssets)
        : collapseLivePhotoComponents(loadedAssets),
    [loadedAssets, photoStacks, libraryMode, photoView, libraryView],
  );
  useEffect(() => {
    if (
      isAssetView &&
      !assets.length &&
      assetsQuery.hasNextPage &&
      !assetsQuery.isFetching &&
      !assetsQuery.isFetchNextPageError &&
      !workspaceCache.operations.hasPending()
    )
      void assetsQuery.fetchNextPage({ cancelRefetch: false });
  }, [
    isAssetView,
    assets.length,
    assetsQuery.hasNextPage,
    assetsQuery.isFetching,
    assetsQuery.isFetchNextPageError,
    assetsQuery.fetchNextPage,
    workspaceCache,
    operationRevision,
  ]);
  const previewStack = previewAssetId ? photoStacksByAsset.get(previewAssetId) : undefined;
  const assetsById = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);
  useEffect(() => {
    if (
      !isAssetView ||
      !showsAssetControls ||
      !assetsQuery.isFetched ||
      assetsQuery.isFetching ||
      assetsQuery.isPlaceholderData
    )
      return;
    selection.reconcile(new Set(assetsById.keys()));
  }, [
    isAssetView,
    showsAssetControls,
    assetsQuery.isFetched,
    assetsQuery.isFetching,
    assetsQuery.isPlaceholderData,
    assetsById,
    selectedAssetId,
  ]);
  const selectedAssetSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const selectedAssetMenuKey = useMemo(
    () => `${storeScope}:${[...selectedAssetIds].sort().join(',')}`,
    [storeScope, selectedAssetIds],
  );
  const selectedTransferAssets = useMemo(
    () =>
      selectedAssetIds.flatMap((id) => {
        const asset = assetsById.get(id);
        return asset ? [asset] : [];
      }),
    [selectedAssetIds, assetsById],
  );
  const contextMenuAsset =
    selectedAssetIds.length === 1 ? (assetsById.get(selectedAssetIds[0]) ?? null) : null;
  const imageClipboardAvailable = canCopyImageToClipboard();
  const selectedAssetQuery = useQuery({
    queryKey: queryKeys.assetDetail(selectedAssetId, libraryView),
    queryFn: ({ signal }) =>
      libraryView === 'TRASH'
        ? getEagleTrashAsset(selectedAssetId!, signal)
        : getEagleAsset(selectedAssetId!, signal),
    enabled: selectedAssetId !== null && isInspectorVisible,
  });
  const selectedAsset: EagleAsset | null = selectedAssetQuery.data ?? null;
  const isSelectedAssetReadOnly = libraryView === 'TRASH';
  const selectedAssetVersions: EagleAssetVersion[] = useMemo(
    () =>
      selectedAssetIds.flatMap((assetId) => {
        const listVersion = assetsById.get(assetId)?.rowVersion;
        const detailVersion = assetId === selectedAsset?.id ? selectedAsset.rowVersion : undefined;
        const versions = [listVersion, detailVersion].filter(
          (version): version is number => version !== undefined,
        );
        return versions.length ? [{ assetId, rowVersion: Math.max(...versions) }] : [];
      }),
    [selectedAssetIds, assetsById, selectedAsset],
  );
  const selectedRating = useMemo(
    () =>
      selectedAssetIds.every(
        (assetId) =>
          assetsById.get(assetId)?.rating === assetsById.get(selectedAssetIds[0])?.rating,
      )
        ? assetsById.get(selectedAssetIds[0])?.rating
        : undefined,
    [selectedAssetIds, assetsById],
  );
  const pendingRating = ratingMutation.isPending ? ratingMutation.variables?.rating : undefined;
  const manualTags = manualTagsQuery.data ?? [];
  const selectedManualTagSummaries = useMemo(() => {
    const tagsById = new Map<
      string,
      {
        tag: EagleAsset['manualTags'][number];
        assetCount: number;
      }
    >();
    for (const assetId of selectedAssetIds) {
      const tags =
        assetId === selectedAsset?.id
          ? selectedAsset.manualTags
          : (assetsById.get(assetId)?.manualTags ?? []);
      const uniqueTags = new Map(tags.map((tag) => [tag.id, tag]));
      uniqueTags.forEach((tag) => {
        const current = tagsById.get(tag.id);
        tagsById.set(tag.id, { tag, assetCount: (current?.assetCount ?? 0) + 1 });
      });
    }
    return [...tagsById.values()].sort((left, right) =>
      left.tag.name.localeCompare(right.tag.name),
    );
  }, [assetsById, selectedAsset, selectedAssetIds]);
  const removableManualTags = useMemo(() => {
    const manualTagsById = new Map(manualTags.map((tag) => [tag.id, tag]));
    return selectedManualTagSummaries.map(({ tag, assetCount }) => {
      const completeTag = manualTagsById.get(tag.id);
      if (completeTag) return completeTag;
      return {
        ...tag,
        groupId: null,
        groupIds: [],
        isStarred: false,
        rowVersion: 0,
        assetCount,
        lastUsedAt: null,
        pinyin: tag.name,
        pinyinInitials: tag.name,
      } satisfies EagleManualTag;
    });
  }, [manualTags, selectedManualTagSummaries]);
  const selectedAssetCountByTagId = useMemo(
    () =>
      Object.fromEntries(
        selectedManualTagSummaries.map(({ tag, assetCount }) => [tag.id, assetCount]),
      ),
    [selectedManualTagSummaries],
  );
  const colorCoverage = assetsQuery.data?.pages[0]?.colorCoverage ?? null;
  const timelineSectionKeys = useMemo(
    () =>
      isPhotoTimeline &&
      !deferredSearch &&
      !deferredQuickFilters.color &&
      !colorCoverage &&
      !(activeSmartFolderId && smartFolderOrder === 'RELEVANCE')
        ? compact
          ? createPhotoTimelineDayKeys(assets)
          : createPhotoTimelineSectionKeys(assets)
        : undefined,
    [
      assets,
      isPhotoTimeline,
      deferredSearch,
      deferredQuickFilters.color,
      colorCoverage,
      compact,
      activeSmartFolderId,
      smartFolderOrder,
    ],
  );
  const { containerRef: masonryRef, layout: masonryLayout } = useEagleMasonryLayout(assets, {
    targetCardWidth: thumbnailSize,
    strategy: compact ? 'square' : isPhotoTimeline ? 'justified' : 'masonry',
    sectionKeys: timelineSectionKeys,
  });
  const prependAnchor = useEaglePrependAnchor(
    masonryLayout.items,
    assetViewport,
    JSON.stringify(queryKeys.assetList(libraryView, assetFilters)),
  );
  useEffect(
    () => workspaceCache.operations.subscribeBeforeChange(prependAnchor.capture),
    [workspaceCache, prependAnchor.capture],
  );
  const loadPreviousPage = useCallback(() => {
    if (!browserCursor || !assetsQuery.hasPreviousPage || assetsQuery.isFetching) return;
    prependAnchor.capture();
    void assetsQuery.fetchPreviousPage({ cancelRefetch: false }).then((result) => {
      if (result.isError) prependAnchor.clear();
    });
  }, [
    browserCursor,
    assetsQuery.hasPreviousPage,
    assetsQuery.isFetching,
    assetsQuery.fetchPreviousPage,
    prependAnchor.capture,
    prependAnchor.clear,
  ]);
  useEffect(() => {
    if (scrollTop <= 600 && !assetsQuery.isFetchPreviousPageError) loadPreviousPage();
  }, [scrollTop, assetsQuery.isFetchPreviousPageError, loadPreviousPage]);
  const masonryViewportIndex = useMemo(
    () => buildMasonryViewportIndex(masonryLayout.items),
    [masonryLayout.items],
  );
  const visibleMasonryItems = useMemo(
    () =>
      selectVisibleMasonryItemsFromIndex(masonryViewportIndex, {
        scrollTop,
        viewportHeight,
        overscan: Math.max(300, viewportHeight * 0.75),
      }),
    [masonryViewportIndex, scrollTop, viewportHeight],
  );
  const sectionViewportIndex = useMemo(
    () => buildMasonryViewportIndex(masonryLayout.sections),
    [masonryLayout.sections],
  );
  const visibleSections = useMemo(
    () =>
      selectVisibleMasonryItemsFromIndex(sectionViewportIndex, {
        scrollTop,
        viewportHeight,
        overscan: Math.max(300, viewportHeight * 0.75),
      }),
    [sectionViewportIndex, scrollTop, viewportHeight],
  );
  const observedAssets = useMemo(() => {
    const observedIds = new Set(visibleMasonryItems.map((item) => item.id));
    selectedAssetIds.forEach((assetId) => observedIds.add(assetId));
    if (selectedAssetId) observedIds.add(selectedAssetId);
    return [...observedIds].flatMap((assetId) => {
      const observed = assetsById.get(assetId);
      return observed ? [observed] : [];
    });
  }, [assetsById, selectedAssetId, selectedAssetIds, visibleMasonryItems]);
  const processingStackMembers = useMemo(() => {
    const visibleIds = new Set(observedAssets.map(({ id }) => id));
    return photoStacks
      .filter(({ cover }) => visibleIds.has(cover.id))
      .flatMap((stack) => stack.processingAssetIds ?? []);
  }, [observedAssets, photoStacks]);
  useEagleProcessingUpdates({
    additionalProcessingAssetIds: processingStackMembers,
    assetsQueryKey: queryKeys.assets,
    assets: observedAssets,
    enabled: isAssetView,
    assetStore,
    updatesQueryKey: queryKeys.assetUpdates,
  });
  const manualTagGroups = manualTagGroupsQuery.data ?? [];
  const smartFolders = smartFoldersQuery.data ?? [];
  const previewAssets = imagePreview.context ?? assets;
  const previewAsset = previewAssets.find((asset) => asset.id === previewAssetId) ?? null;
  const previewImageAsset = imagePreview.previewImage?.assetId
    ? (previewAssets.find((asset) => asset.id === imagePreview.previewImage?.assetId) ?? null)
    : null;
  const previewCanHavePyramid = Boolean(
    previewImageAsset && needsEagleImagePyramid(previewImageAsset.width, previewImageAsset.height),
  );
  const previewPyramidQuery = useQuery({
    queryKey: queryKeys.pyramid(imagePreview.previewImage?.assetId ?? 'none'),
    queryFn: ({ signal }) => getEaglePyramidDescriptor(imagePreview.previewImage!.assetId!, signal),
    enabled: Boolean(imagePreview.previewImage?.assetId && previewCanHavePyramid),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    // The high-resolution pyramid may still be generated after the preview opens.
    // Keep checking the open image so it upgrades without a manual refresh.
    refetchInterval: (query) => (query.state.data ? false : 15_000),
  });
  const isInspectorOpen = isAssetView && isInspectorVisible;
  const activeSmartFolder =
    smartFolders.find((folder) => folder.id === activeSmartFolderId) ?? null;
  const semanticSignature = smartFolders
    .filter(
      (folder) =>
        activeSmartFolderId !== null &&
        folder.semanticState &&
        (folder.id === activeSmartFolderId || folder.parentId === activeSmartFolderId),
    )
    .map(
      (folder) =>
        `${folder.semanticState?.id}:${folder.semanticState?.status}:${folder.semanticState?.updatedAt}`,
    )
    .join('|');
  const semanticRefreshRef = useRef(new Map<string, string>());
  useEffect(() => {
    const key = `${storeScope}:${activeSmartFolderId}`;
    const previous = semanticRefreshRef.current.get(key);
    semanticRefreshRef.current.set(key, semanticSignature);
    if (semanticSignature && previous !== undefined && previous !== semanticSignature)
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets });
  }, [semanticSignature, activeSmartFolderId, queryClient, queryKeys.assets, storeScope]);
  const color = quickFilters.color;
  useEffect(() => {
    if (!isInspectorVisible || !selectedAsset) return;
    if (metadataDraft.assetId !== selectedAsset.id) metadataMutation.reset();
    metadataDraft.load(selectedAsset);
  }, [
    isInspectorVisible,
    selectedAsset?.id,
    selectedAsset?.updatedAt,
    selectedAssetQuery.dataUpdatedAt,
    editingScope,
  ]);
  const saveEditedMetadata = () => {
    if (
      !selectedAsset ||
      isSelectedAssetReadOnly ||
      metadataFormRef.current?.checkValidity() === false
    )
      return;
    const submission = metadataDraft.submission();
    if (submission?.assetId === selectedAsset.id)
      metadataMutation.mutate({ ...submission, assets: selectedAssetVersions });
  };
  useEffect(
    () => () => {
      thumbnailScheduler.clear({ abortActive: true });
    },
    [thumbnailScheduler],
  );
  useEffect(() => {
    const sentinel = pageSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry.isIntersecting &&
          !assetsQuery.isPlaceholderData &&
          assetsQuery.hasNextPage &&
          !assetsQuery.isFetchingNextPage
        ) {
          void assetsQuery.fetchNextPage();
        }
      },
      { root: assetViewportRef.current, rootMargin: '600px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    assetsQuery.fetchNextPage,
    assetsQuery.hasNextPage,
    assetsQuery.isFetchingNextPage,
    assetsQuery.isPlaceholderData,
    libraryView,
  ]);
  const resetFilters = () => {
    setQuickFilters(createEmptyEagleQuickFilterState());
  };
  const navigateLibrary = (
    destination:
      | { view: EagleLibraryView; photoView?: EaglePhotoView }
      | { view: 'SMART_FOLDER'; folder: EagleSmartFolder },
  ) => {
    const folder = destination.view === 'SMART_FOLDER' ? destination.folder : null;
    const view = destination.view === 'SMART_FOLDER' ? 'ACTIVE' : destination.view;
    setFilterResetKey((key) => key + 1);
    assetLocator.clearLocation();
    setTimelineCursor('');
    setLibraryView(view);
    setPhotoView(
      destination.view === 'ACTIVE' ? (destination.photoView ?? 'timeline') : 'timeline',
    );
    setActiveSmartFolderId(folder?.id ?? null);
    setSmartFolderOrder(
      folder &&
        (folder.semanticState || readEagleSemanticIntent(toEagleFilterQuery(folder.queryJson)))
        ? 'RELEVANCE'
        : 'DATE',
    );
    if (
      folder ||
      view === 'PRIVATE' ||
      view === 'TRASH' ||
      libraryView === 'PRIVATE' ||
      libraryView === 'TRASH'
    ) {
      resetFilters();
    }
    clearAssetSelection();
    setTagPicker(null);
  };
  const changeLibraryView = (view: EagleLibraryView) => {
    navigateLibrary({ view });
    if (view === 'VECTOR_REVIEW' || view === 'VECTOR_UNCLASSIFIED') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vectorSummary });
    }
  };
  const openLibraryRoot = (photoView: EaglePhotoView = 'timeline') =>
    navigateLibrary({ view: 'ACTIVE', photoView });
  const applySmartFolder = (folder: EagleSmartFolder) =>
    navigateLibrary({ view: 'SMART_FOLDER', folder });
  const deleteSmartFolder = (folder: EagleSmartFolder) => {
    if (
      window.confirm(t('删除智能文件夹“{{value1}}”？素材本身不会被删除。', { value1: folder.name }))
    )
      deleteSmartFolderMutation.mutate(folder);
  };
  const selectAsset = (assetId: string, gesture: EagleSelectionGesture) =>
    selection.select(
      assets.map((asset) => asset.id),
      assetId,
      gesture,
    );
  const {
    desktopAssetDragBridge,
    assetDragSession,
    isDragging,
    originalFileError,
    setOriginalFileError,
    assetDragStatus,
    isBatchDownloading,
    assetActionPending,
    assetActionError,
    setAssetActionError,
    saveSelectedOriginal,
    copySelectedImage,
    handleAssetDragStart,
    batchDownloadSelectedOriginals,
    handleAssetDragEnd,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  } = useEagleAssetTransferActions({
    libraryMode,
    libraryView,
    ownerId,
    assets,
    selectedAssetIds,
    contextMenuAsset,
    workspaceCache,
    getEagleAsset,
    selectAsset,
    setAssetContextMenu,
    importFiles,
  });
  useEffect(() => {
    if (tagPicker) return undefined;
    if (!selectionMode && !isBatchSelection && !assetContextMenu) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (assetContextMenu) setAssetContextMenu(null);
      else clearAssetSelection();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assetContextMenu, clearAssetSelection, isBatchSelection, selectionMode, tagPicker]);
  const handleAssetClick = (event: MouseEvent<HTMLButtonElement>, assetId: string) => {
    setAssetContextMenu(null);
    if (compact && !selectionMode && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const asset = assetsById.get(assetId);
      if (asset) openAssetPreview(asset);
      return;
    }
    const gesture: EagleSelectionGesture = event.shiftKey
      ? 'range'
      : selectionMode || event.ctrlKey || event.metaKey
        ? 'toggle'
        : 'single';
    selectAsset(assetId, gesture);
  };
  const handleAssetContextMenu = (event: MouseEvent<HTMLButtonElement>, assetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (compact) {
      setSelectionMode(true);
      if (!selectedAssetIds.includes(assetId)) selectAsset(assetId, 'toggle');
      return;
    }
    if (!selectedAssetIds.includes(assetId)) selectAsset(assetId, 'single');
    openAssetContextMenu(event.clientX, event.clientY);
  };
  const openAssetContextMenu = (x: number, y: number) => {
    setAssetActionError(null);
    setAssetContextMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 228)),
      y: Math.max(8, Math.min(y, window.innerHeight - 280)),
    });
  };
  const locationId = assetLocator.location?.assetId;
  const locationCoverId =
    (locationId ? photoStacksByAsset.get(locationId)?.cover.id : undefined) ??
    loadedAssets.find((asset) => asset.livePhotoMotion?.assetId === locationId)?.id ??
    locationId;
  useEagleAssetLocationFocus({
    location: assetLocator.location,
    targetId: locationCoverId,
    items: masonryLayout.items,
    viewport: assetViewport,
    enabled: hasAssetLocation && !assetsQuery.isFetching,
    onSelect: (id) => selectAsset(id, 'single'),
  });
  const openAssetPreview = (asset: EagleAssetListItem, context?: EagleAssetListItem[]) => {
    const items = context ?? (assetsById.has(asset.id) ? [] : [asset]);
    if (imagePreview.open(asset, items, photoStacksByAsset.has(asset.id)) === 'image')
      preloadEagleImageViewer();
  };
  const handleAssetDoubleClick = (asset: EagleAssetListItem) => {
    if (!selectionMode) openAssetPreview(asset);
  };
  const handleAssetKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    asset: EagleAssetListItem,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectionMode) selectAsset(asset.id, 'toggle');
      else {
        selectAsset(asset.id, 'single');
        openAssetPreview(asset);
      }
    }
  };
  const cardActionsRef = useRef({
    handleAssetClick,
    handleAssetContextMenu,
    handleAssetDragStart,
    handleAssetDragEnd,
    handleAssetDoubleClick,
    handleAssetKeyDown,
    handleAssetProcessingActions,
  });
  cardActionsRef.current = {
    handleAssetClick,
    handleAssetContextMenu,
    handleAssetDragStart,
    handleAssetDragEnd,
    handleAssetDoubleClick,
    handleAssetKeyDown,
    handleAssetProcessingActions,
  };
  const cardActions = useMemo<AssetCardActions>(
    () => ({
      click: (event, assetId) => cardActionsRef.current.handleAssetClick(event, assetId),
      contextMenu: (event, assetId) =>
        cardActionsRef.current.handleAssetContextMenu(event, assetId),
      dragStart: (event, assetId) => cardActionsRef.current.handleAssetDragStart(event, assetId),
      dragEnd: () => cardActionsRef.current.handleAssetDragEnd(),
      doubleClick: (asset) => cardActionsRef.current.handleAssetDoubleClick(asset),
      keyDown: (event, asset) => cardActionsRef.current.handleAssetKeyDown(event, asset),
      processingActions: (asset) => cardActionsRef.current.handleAssetProcessingActions(asset),
    }),
    [],
  );
  const previewNavigation = useEaglePreviewNavigation(
    previewAssets,
    imagePreview.previewImage,
    imagePreview.setPreviewImage,
  );
  useEffect(() => {
    const current = imagePreview.previewImage;
    if (!current?.assetId) return;
    const asset = assetsById.get(current.assetId);
    if (!asset) return;
    const motionSrc = getEagleLivePhotoContentUrl(asset);
    if (current.motionSrc !== motionSrc) imagePreview.setPreviewImage({ ...current, motionSrc });
  }, [assetsById, imagePreview.previewImage, imagePreview.setPreviewImage]);
  const showAssetsForTag = (tagId: string) => {
    changeLibraryView('ACTIVE');
    setQuickFilters({ ...createEmptyEagleQuickFilterState(), manualTagIds: [tagId] });
  };
  const peopleOptionsAction =
    libraryMode === 'PHOTO' ? (
      <>
        {photoFieldOptions.people.error && (
          <span role="alert">
            {photoFieldOptions.people.error.message}
            <button type="button" onClick={() => void photoFieldOptions.people.refetch()}>
              {t('重试')}
            </button>
          </span>
        )}
        {photoFieldOptions.people.hasNextPage && (
          <button
            type="button"
            disabled={photoFieldOptions.people.isFetchingNextPage}
            onClick={() => void photoFieldOptions.people.fetchNextPage()}
          >
            {t('加载更多人物')}
          </button>
        )}
      </>
    ) : undefined;
  const quickFilterPanel =
    libraryView === 'ACTIVE' && showsAssetControls && filtersExpanded ? (
      <div id={filterPanelId}>
        <EagleQuickFilterBar
          presentation={compact ? 'sheet' : 'toolbar'}
          fieldOptions={photoFieldOptions.fieldOptions}
          value={quickFilters}
          manualTags={manualTags}
          onChange={setQuickFilters}
        />
        {peopleOptionsAction}
      </div>
    ) : null;
  const selectionToolbar = showsAssetControls &&
    photoView === 'timeline' &&
    (selectionMode || isBatchSelection) && (
      <EagleSelectionToolbar
        selecting={selectionMode}
        count={selectedAssetIds.length}
        onToggle={() => (selectionMode ? clearAssetSelection() : setSelectionMode(true))}
        onActions={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          openAssetContextMenu(bounds.right - 220, bounds.bottom + 6);
        }}
        onBatchEdit={
          photoEditing.clipboard ? () => setBatchEditIds([...selectedAssetIds]) : undefined
        }
        onPreview={
          selectedAssetIds.length === 1 && assetsById.has(selectedAssetIds[0])
            ? () => openAssetPreview(assetsById.get(selectedAssetIds[0])!)
            : undefined
        }
      />
    );
  const libraryNavigation = (closeNavigation: () => void) => (
    <>
      <button
        data-navigation-destination
        className={
          libraryView === 'ACTIVE' && !activeSmartFolderId && photoView === 'timeline'
            ? styles.navActive
            : undefined
        }
        aria-current={
          libraryView === 'ACTIVE' && !activeSmartFolderId && photoView === 'timeline'
            ? 'page'
            : undefined
        }
        type="button"
        onClick={() => openLibraryRoot()}
      >
        <IconPhoto size={17} />
        {' ' + t('全部') + ' '}
        {libraryView === 'ACTIVE' && !activeSmartFolderId && (
          <span>{libraryCount.data ?? '…'}</span>
        )}
      </button>
      {libraryMode === 'PHOTO' &&
        (['map', 'people', 'agent', 'statistics'] as const).map((view) => (
          <button
            data-navigation-destination
            key={view}
            type="button"
            className={
              libraryView === 'ACTIVE' && photoView === view && !activeSmartFolderId
                ? styles.navActive
                : undefined
            }
            aria-current={
              libraryView === 'ACTIVE' && photoView === view && !activeSmartFolderId
                ? 'page'
                : undefined
            }
            onClick={() => openLibraryRoot(view)}
          >
            {view === 'map' ? (
              <IconMapPin size={17} />
            ) : view === 'statistics' ? (
              <IconChartBar size={17} />
            ) : (
              <IconUsers size={17} />
            )}
            {view === 'map'
              ? t('地图')
              : view === 'people'
                ? t('人物')
                : view === 'statistics'
                  ? t('照片统计')
                  : t('智能整理')}
          </button>
        ))}
      {privateVisible && (
        <button
          data-navigation-destination
          className={libraryView === 'PRIVATE' ? styles.navActive : undefined}
          aria-current={libraryView === 'PRIVATE' ? 'page' : undefined}
          type="button"
          onClick={() => changeLibraryView('PRIVATE')}
          aria-label={libraryMode === 'PHOTO' ? t('隐私照片') : t('隐私素材')}
        >
          <IconLock size={17} />
          {' ' + (libraryMode === 'PHOTO' ? t('隐私照片') : t('隐私素材')) + ' '}
          {libraryView === 'PRIVATE' && <span>{loadedAssets.length}</span>}
        </button>
      )}
      <div className={`${styles.navSection} ${styles.smartFolderSection}`}>
        <div className={styles.sectionLabel}>
          {' ' + t('智能文件夹') + ' '}
          <button
            data-navigation-destination
            type="button"
            aria-label={t('新建智能文件夹')}
            onClick={() => {
              setEditingSmartFolder(null);
              setIsSmartFolderDialogOpen(true);
            }}
          >
            <IconPlus size={15} />
          </button>
        </div>
        <EagleSmartFolderTree
          folders={smartFolders}
          activeFolderId={activeSmartFolderId}
          busy={
            updateSmartFolderMutation.isPending ||
            deleteSmartFolderMutation.isPending ||
            moveSmartFolderMutation.isPending
          }
          onSelect={(folder) => {
            closeNavigation();
            applySmartFolder(folder);
          }}
          onMove={(folder, input) => moveSmartFolderMutation.mutate({ folder, input })}
          onChangeColor={(folder, color) =>
            updateSmartFolderMutation.mutate({ folder, changes: { color } })
          }
          onEdit={(folder) => {
            closeNavigation();
            setEditingSmartFolder(folder);
            setIsSmartFolderDialogOpen(true);
          }}
          onDelete={deleteSmartFolder}
        />
        {smartFoldersQuery.isError && (
          <button
            data-navigation-destination
            className={styles.navError}
            type="button"
            onClick={() => void smartFoldersQuery.refetch()}
          >
            <IconRefresh size={15} />
            {' ' + t('加载失败，重试') + ' '}
          </button>
        )}
        {!smartFoldersQuery.isLoading &&
          !smartFoldersQuery.isError &&
          smartFolders.length === 0 && <span className={styles.navEmpty}>{t('尚未创建')}</span>}
      </div>
      <div className={styles.navSection}>
        <button
          data-navigation-destination
          type="button"
          className={workspaceSection === 'TASKS' ? styles.navActive : undefined}
          aria-current={workspaceSection === 'TASKS' ? 'page' : undefined}
          aria-label={t('任务中心')}
          onClick={() => changeLibraryView('PROCESSING')}
        >
          <IconRefresh size={17} />
          {' ' + t('任务中心')}
        </button>
        <button
          data-navigation-destination
          type="button"
          className={workspaceSection === 'TAGS' ? styles.navActive : undefined}
          aria-current={workspaceSection === 'TAGS' ? 'page' : undefined}
          aria-label={t('标签')}
          onClick={() => changeLibraryView('MANUAL_TAGS')}
        >
          <IconTags size={17} />
          {' ' + t('标签')}
        </button>
        <button
          data-navigation-destination
          type="button"
          className={workspaceSection === 'PENDING' ? styles.navActive : undefined}
          aria-current={workspaceSection === 'PENDING' ? 'page' : undefined}
          aria-label={`${t('待处理')} ${pendingWorkCount}`}
          onClick={() => changeLibraryView('VECTOR_REVIEW')}
        >
          <IconCheck size={17} />
          {' ' + t('待处理')}
          <span>{pendingWorkCount}</span>
        </button>
        <button
          data-navigation-destination
          type="button"
          className={workspaceSection === 'SETTINGS' ? styles.navActive : undefined}
          aria-current={workspaceSection === 'SETTINGS' ? 'page' : undefined}
          aria-label={t('设置')}
          onClick={() => changeLibraryView(accountView ? 'ACCOUNT' : 'VECTOR_TAGS')}
        >
          <IconSettings size={17} />
          {' ' + t('设置')}
        </button>
      </div>
      <button
        type="button"
        data-navigation-destination
        onClick={() => {
          closeNavigation();
          setDuplicatesOpen(true);
        }}
      >
        <IconPhoto size={17} /> {t('查重清理')}
      </button>
      <button
        data-navigation-destination
        className={libraryView === 'TRASH' ? styles.navActive : undefined}
        aria-current={libraryView === 'TRASH' ? 'page' : undefined}
        type="button"
        aria-label={t('回收站')}
        onClick={() => changeLibraryView('TRASH')}
      >
        <IconTrash size={17} />
        {' ' + t('回收站') + ' '}
      </button>
    </>
  );
  useMobileBack(() => {
    if (mobileSearch) {
      setMobileSearch(false);
      return true;
    }
    if (mobileMore) {
      setMobileMore(false);
      return true;
    }
    if (workspaceSection === 'SETTINGS') {
      changeLibraryView('ACTIVE');
      setMobileMore(true);
      return true;
    }
    if (libraryView !== 'ACTIVE' || photoView !== 'timeline') {
      changeLibraryView('ACTIVE');
      return true;
    }
    if (search) {
      setSearch('');
      return true;
    }
    return false;
  }, 0);
  const navigateMobile = (destination: MobileDestination) => {
    setMobileMore(destination === 'more');
    setMobileSearch(false);
    clearAssetSelection();
    if (destination === 'tags') {
      changeLibraryView('MANUAL_TAGS');
    } else if (destination === 'tasks') {
      changeLibraryView('PROCESSING');
    } else if (destination !== 'more') {
      openLibraryRoot(destination);
    }
  };
  const activeMobileDestination: MobileDestination =
    workspaceSection === 'TASKS'
      ? 'tasks'
      : mobileMore || workspaceSection === 'SETTINGS'
        ? 'more'
        : workspaceSection === 'TAGS'
          ? 'tags'
          : photoView === 'map' || photoView === 'people'
            ? photoView
            : 'timeline';
  const toolbarTools = (
    <EagleResponsiveTools
      className={styles.toolbarActions}
      scopeKey={storeScope}
      panel={quickFilterPanel}
      actions={
        compact ? (
          <>
            <EagleMobileNavigation
              mode={libraryMode}
              active={activeMobileDestination}
              onNavigate={navigateMobile}
            />
            <div data-dismiss-tools>{selectionToolbar}</div>
            {libraryView !== 'TRASH' && <EagleImportButton onImport={importFiles} />}
            <details>
              <summary>{t('图库管理')}</summary>
              <div data-dismiss-tools className={`${styles.sidebar} ${styles.mobileNavigation}`}>
                {libraryNavigation(() => {
                  setMobileMore(false);
                  setMobileSearch(false);
                })}
              </div>
            </details>
          </>
        ) : undefined
      }
      count={activeFilterCount}
    >
      {libraryView === 'ACTIVE' && (
        <>
          <button
            type="button"
            className={filtersExpanded || activeFilterCount ? styles.filterActive : undefined}
            aria-label={filtersExpanded ? t('收起筛选') : t('展开筛选')}
            aria-expanded={filtersExpanded}
            aria-controls={filterPanelId}
            title={
              activeFilterCount
                ? t('已启用 {{value1}} 项筛选', { value1: activeFilterCount })
                : filtersExpanded
                  ? t('收起筛选')
                  : t('展开筛选')
            }
            onClick={() => setFiltersExpanded((current) => !current)}
          >
            <IconFilter size={18} aria-hidden="true" />
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
            {filtersExpanded ? (
              <IconChevronUp size={14} aria-hidden="true" />
            ) : (
              <IconChevronDown size={14} aria-hidden="true" />
            )}
          </button>
          {!filtersExpanded && activeFilterCount > 0 && (
            <button
              type="button"
              aria-label={t('清除全部快捷筛选，共 {{value1}} 项', {
                value1: activeFilterCount,
              })}
              title={t('清除全部快捷筛选，共 {{value1}} 项', {
                value1: activeFilterCount,
              })}
              onClick={() => setQuickFilters(createEmptyEagleQuickFilterState())}
            >
              <IconX size={16} aria-hidden="true" />
            </button>
          )}
        </>
      )}
      {libraryView === 'TRASH' && (
        <button
          type="button"
          aria-label={t('恢复所选 {{count}} 项', { count: selectedAssetIds.length })}
          disabled={selectedAssetIds.length === 0 || restoreMutation.isPending}
          onClick={() => {
            if (selectedAssetIds.length) restoreMutation.mutate(selectedAssetIds);
          }}
        >
          <IconRefresh size={18} />
          {' ' + t('恢复') + ' '}
        </button>
      )}
      {libraryView === 'TRASH' && (
        <button
          className={styles.dangerAction}
          type="button"
          aria-label={t('清空回收站')}
          disabled={assets.length === 0 || emptyTrashMutation.isPending}
          onClick={() => {
            setConfirmEmptyTrash(true);
          }}
        >
          <IconTrash size={18} />
          {' ' + t('清空') + ' '}
        </button>
      )}
      {!compact && (
        <label
          className={styles.thumbnailControl}
          title={t('缩略图大小：{{value1}}px', {
            value1: thumbnailSize,
          })}
        >
          <IconLayoutGrid size={17} aria-hidden="true" />
          <input
            type="range"
            aria-label={t('缩略图大小')}
            min="140"
            max="320"
            step="10"
            value={thumbnailSize}
            onChange={(event) => setThumbnailSize(Number(event.target.value))}
          />
        </label>
      )}
      <button
        type="button"
        className={isInspectorOpen ? styles.filterActive : undefined}
        aria-label={
          isInspectorOpen
            ? t('隐藏素材详情')
            : libraryMode === 'PHOTO'
              ? t('显示照片详情')
              : t('显示素材详情')
        }
        title={t('详情')}
        data-dismiss-tools
        aria-pressed={isInspectorOpen}
        onClick={() => setIsInspectorVisible((value) => !value)}
      >
        <IconLayoutSidebarRight size={18} aria-hidden="true" />
      </button>
    </EagleResponsiveTools>
  );

  return (
    <main
      inert={photoEditing.session !== null}
      className={styles.page}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        if (!assetDragSession?.isOutboundDrag() && isFileDrag(event)) {
          event.preventDefault();
        }
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={`${styles.workspace} ${!isInspectorOpen || compact ? styles.workspaceWide : ''}`}
      >
        {!compact && (
          <EagleLibraryNavigation
            className={styles.sidebar}
            headerClassName={styles.sidebarHeader}
            header={modeSwitcher}
            label={libraryMode === 'PHOTO' ? t('照片库导航') : t('素材库导航')}
            activeKey={`${libraryView}:${photoView}:${activeSmartFolderId}`}
            scopeKey={storeScope}
          >
            {libraryNavigation}
          </EagleLibraryNavigation>
        )}

        {compact && (
          <EagleMobileChrome
            switcher={modeSwitcher}
            searchOpen={mobileSearch}
            onSearch={() => {
              setMobileMore(false);
              setMobileSearch((value) => !value);
              if (!showsAssetControls) {
                openLibraryRoot();
              }
            }}
            tools={toolbarTools}
          >
            {null}
          </EagleMobileChrome>
        )}
        {compact && mobileSearch && (
          <EagleMobileSearch
            key={`${storeScope}:${privateVisible}`}
            scopeKey={storeScope}
            persist={!privateVisible}
            value={search}
            suggestions={privateVisible ? [] : manualTags.map((tag) => tag.name)}
            onClose={() => setMobileSearch(false)}
            onSearch={(value) => {
              setSearch(value);
              setMobileSearch(false);
            }}
          />
        )}
        {compact && mobileMore && (
          <EagleMobileMore
            email={accountSummary?.email ?? ownerId}
            origin={window.location.origin}
            native={isAndroidClient()}
            onSettings={() => {
              setMobileMore(false);
              changeLibraryView('ACCOUNT');
            }}
            onLogout={() => accountSummary?.onLogout()}
          />
        )}
        <section
          hidden={compact && mobileMore}
          className={`${styles.library} ${workspaceSection === 'SETTINGS' ? styles.settingsLibrary : ''}`}
          aria-label={
            workspaceSection === 'TAGS'
              ? t('标签')
              : workspaceSection === 'PENDING'
                ? t('待处理')
                : workspaceSection === 'SETTINGS'
                  ? t('设置')
                  : undefined
          }
          aria-labelledby={workspaceSection || compact ? undefined : 'eagle-library-title'}
        >
          {workspaceSection === 'TAGS' ? (
            <EagleWorkspaceNavigation
              title={t('标签')}
              ariaLabel={t('标签功能')}
              activeView={libraryView}
              items={[{ view: 'MANUAL_TAGS', label: t('人工标签') }]}
              onSelect={changeLibraryView}
            />
          ) : workspaceSection === 'PENDING' ? (
            <EagleWorkspaceNavigation
              title={t('待处理')}
              ariaLabel={t('待处理功能')}
              activeView={libraryView}
              items={[
                {
                  view: 'VECTOR_REVIEW',
                  label: t('推荐审核'),
                  count: vectorSummary?.suggestions.pending ?? 0,
                },
                {
                  view: 'VECTOR_UNCLASSIFIED',
                  label: t('待分类'),
                  count: unavailableSuggestionCount,
                },
                { view: 'PROCESSING', label: t('任务中心') },
              ]}
              onSelect={changeLibraryView}
            />
          ) : workspaceSection === 'SETTINGS' ? (
            <EagleWorkspaceNavigation
              title={t('设置')}
              ariaLabel={t('设置功能')}
              layout={compact ? 'tabs' : 'sidebar'}
              activeView={libraryView}
              items={[
                ...(accountView ? [{ view: 'ACCOUNT' as const, label: t('账号') }] : []),
                { view: 'VECTOR_TAGS', label: t('人工标签推荐') },
              ]}
              onSelect={changeLibraryView}
            />
          ) : null}
          {libraryView === 'ACCOUNT' ? (
            accountView
          ) : libraryView === 'PROCESSING' ? (
            <AsyncViewBoundary>
              <EagleTaskCenter
                key={`${storeScope}:${privateVisible}`}
                includePrivate={privateVisible}
                canManageProcessing={canManageProcessing}
                onReview={() => {
                  openLibraryRoot('agent');
                }}
              />
            </AsyncViewBoundary>
          ) : getVectorWorkspaceView(libraryView) ? (
            <AsyncViewBoundary>
              <EagleVectorWorkspace
                view={getVectorWorkspaceView(libraryView) ?? 'REVIEW'}
                manualTags={manualTags}
                onCreateManualTag={(name) => createBatchTagMutation.mutateAsync(name)}
                onChangeManualTags={async ({ assetIds, addTagIds, removeTagIds }) => {
                  await batchTagMutation.mutateAsync({ assetIds, addTagIds, removeTagIds });
                }}
                onTrashAssets={async (assetIds) => {
                  await trashMutation.mutateAsync(assetIds);
                }}
                onAssetPrivacyChanged={resetAssetPrivacyState}
                onRecommendationsChanged={() =>
                  queryClient.invalidateQueries({ queryKey: queryKeys.vectorSummary })
                }
                onAssetRelationsChanged={(ids) =>
                  refreshEagleAssetRelations(queryClient, queryKeys, ids)
                }
              />
            </AsyncViewBoundary>
          ) : libraryView === 'MANUAL_TAGS' ? (
            <EagleTagPage
              manualTags={manualTags}
              manualTagGroups={manualTagGroups}
              creating={createTagMutation.isPending}
              busy={
                createTagGroupMutation.isPending ||
                updateTagsMutation.isPending ||
                deleteTagsMutation.isPending ||
                updateTagGroupMutation.isPending ||
                deleteTagGroupMutation.isPending
              }
              batchFailure={tagBatchFailure}
              error={
                (
                  createTagMutation.error ??
                  createTagGroupMutation.error ??
                  updateTagsMutation.error ??
                  deleteTagsMutation.error ??
                  updateTagGroupMutation.error ??
                  deleteTagGroupMutation.error ??
                  manualTagsQuery.error ??
                  manualTagGroupsQuery.error
                )?.message
              }
              onCreateManualTag={(name) => createTagMutation.mutate(name)}
              onCreateManualTagGroup={(name) => createTagGroupMutation.mutate(name)}
              onUpdateManualTags={(tags, changes) => updateTagsMutation.mutate({ tags, changes })}
              onDeleteManualTags={(tags) => deleteTagsMutation.mutate(tags)}
              onUpdateManualTagGroup={(group, changes) =>
                updateTagGroupMutation.mutate({ group, changes })
              }
              onDeleteManualTagGroup={(group) => deleteTagGroupMutation.mutate(group)}
              onSelectTag={(tagId) => showAssetsForTag(tagId)}
            />
          ) : (
            <>
              <div className={`${styles.toolbar} ${compact ? styles.mobileToolbar : ''}`}>
                <div className={styles.heading} hidden={compact}>
                  <div className={styles.titleBlock}>
                    <h1
                      id="eagle-library-title"
                      className={
                        libraryView === 'ACTIVE' && !activeSmartFolderId && photoView === 'timeline'
                          ? styles.visuallyHidden
                          : undefined
                      }
                    >
                      {libraryView === 'TRASH'
                        ? t('回收站')
                        : libraryView === 'PRIVATE'
                          ? libraryMode === 'PHOTO'
                            ? t('隐私照片')
                            : t('隐私素材')
                          : (activeSmartFolder?.name ??
                            (libraryMode === 'PHOTO'
                              ? photoView === 'map'
                                ? t('地图')
                                : photoView === 'people'
                                  ? t('人物')
                                  : photoView === 'agent'
                                    ? t('智能整理')
                                    : photoView === 'statistics'
                                      ? t('照片统计')
                                      : t('全部')
                              : t('全部')))}
                    </h1>
                    {privateVisible && privacyVisibility?.expiresAt ? (
                      <span className={styles.privacyStatus}>
                        <IconLock size={12} />
                        {' ' + t('隐私内容已显示') + ' '}
                      </span>
                    ) : null}
                  </div>
                </div>
                <EagleSmartFolderStatus
                  state={activeSmartFolder?.semanticState}
                  order={smartFolderOrder}
                  pending={updateSmartFolderMutation.isPending}
                  onRetry={() =>
                    activeSmartFolder &&
                    updateSmartFolderMutation.mutate({
                      folder: activeSmartFolder,
                      changes: { query: toEagleFilterQuery(activeSmartFolder.queryJson) },
                    })
                  }
                  onOrderChange={(order) => {
                    setSmartFolderOrder(order);
                    assetLocator.clearLocation();
                  }}
                />
                {!compact && libraryView !== 'TRASH' && (
                  <EagleImportButton onImport={importFiles} />
                )}
                {showsAssetControls && (
                  <>
                    <label className={styles.searchBox} hidden={compact}>
                      <IconSearch size={17} aria-hidden="true" />
                      <input
                        type="search"
                        aria-label={libraryMode === 'PHOTO' ? t('搜索照片') : t('搜索素材')}
                        placeholder={t('搜索名称或描述画面内容')}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      {search && (
                        <button
                          type="button"
                          aria-label={t('清除搜索')}
                          onClick={() => setSearch('')}
                        >
                          <IconX size={14} />
                        </button>
                      )}
                    </label>
                    {!compact && toolbarTools}
                  </>
                )}
              </div>

              {!compact && quickFilterPanel}

              {deferredSearch &&
                assetsQuery.data?.pages[0]?.imageSearch?.status === 'UNAVAILABLE' && (
                  <div className={styles.statusBar} role="status">
                    {t('图片内容搜索暂不可用，当前仅匹配名称和人工标签。')}
                  </div>
                )}
              <EagleOperationNotices onShowProgress={() => changeLibraryView('PROCESSING')} />

              {selectionToolbar}
              <EagleUploadQueue
                items={uploads}
                summary={uploadSummary}
                onPause={pauseUploads}
                onResume={resumeUploads}
                onRetryAll={retryAllFailed}
                onRetry={retryUpload}
                onDismiss={dismissUploads}
              />
              {assetDragStatus && (
                <div className={styles.statusBar} role="status">
                  {assetDragStatus.phase === 'preparing'
                    ? t('正在准备原文件（{{value1}}/{{value2}}）…', {
                        value1: assetDragStatus.completed,
                        value2: assetDragStatus.total,
                      })
                    : t('原文件准备已取消，可重新拖动。')}
                </div>
              )}
              {originalFileError && (
                <div
                  className={`${styles.errorBar} ${styles.dismissibleError}`}
                  role="alert"
                  key={originalFileError.id}
                >
                  <span>{originalFileError.message}</span>
                  <button
                    type="button"
                    aria-label={t('关闭')}
                    title={t('关闭')}
                    onClick={() => setOriginalFileError(null)}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              )}
              {color && colorCoverage && colorCoverage.percentage < 100 ? (
                <div className={styles.statusBar} role="status">
                  {' ' + t('颜色结果仍在补全：')}
                  {colorCoverage.completed}/{colorCoverage.eligible}
                  {' ' + t('已分析（') + ' '}
                  {colorCoverage.percentage}%）
                </div>
              ) : null}
              {(trashMutation.isError ||
                restoreMutation.isError ||
                emptyTrashMutation.isError ||
                updateSmartFolderMutation.isError ||
                deleteSmartFolderMutation.isError ||
                moveSmartFolderMutation.isError) && (
                <div className={styles.errorBar} role="alert">
                  {
                    (
                      trashMutation.error ??
                      restoreMutation.error ??
                      emptyTrashMutation.error ??
                      updateSmartFolderMutation.error ??
                      deleteSmartFolderMutation.error ??
                      moveSmartFolderMutation.error
                    )?.message
                  }
                </div>
              )}
              {libraryMode === 'PHOTO' && photoView === 'statistics' && (
                <AsyncViewBoundary>
                  <PhotoStatistics
                    key={`${ownerId}:${privateVisible}`}
                    ownerId={ownerId}
                    includePrivate={privateVisible}
                  />
                </AsyncViewBoundary>
              )}
              {libraryMode === 'PHOTO' && photoView === 'agent' && (
                <AsyncViewBoundary>
                  <PhotoAgentReview
                    key={`${ownerId}:${privateVisible}`}
                    includePrivate={privateVisible}
                  />
                </AsyncViewBoundary>
              )}
              {libraryMode === 'PHOTO' && photoView === 'people' && (
                <PhotoCollections
                  scopeRevision={editingScope}
                  onPrivacyRulesChange={onPrivacyRulesChange ?? resetAssetPrivacyState}
                  includePrivate={privateVisible}
                  onOpen={openAssetPreview}
                  onPerson={(personId) => {
                    setQuickFilters((current) => ({
                      ...current,
                      choices: { ...current.choices, PERSON: personId },
                    }));
                    setPhotoView('timeline');
                  }}
                />
              )}
              {libraryMode === 'PHOTO' && photoView === 'map' && (
                <AsyncViewBoundary>
                  <PhotoMap
                    key={`${ownerId}:${privateVisible}`}
                    ownerId={ownerId}
                    includePrivate={privateVisible}
                    onOpen={openAssetPreview}
                  />
                </AsyncViewBoundary>
              )}
              <div
                className={styles.assetBrowser}
                style={
                  libraryMode === 'PHOTO' && photoView !== 'timeline'
                    ? { display: 'none' }
                    : undefined
                }
              >
                {showLoadingFeedback && (
                  <div className={styles.queryProgress} role="status" aria-label={t('正在加载…')}>
                    {t('正在加载…')}
                  </div>
                )}
                <div
                  ref={assetViewport.containerRef}
                  className={`${styles.assetViewport} ${isPhotoTimeline ? styles.horizontalViewport : ''}`}
                  role="region"
                  aria-label={libraryMode === 'PHOTO' ? t('照片时间线') : t('素材瀑布流')}
                  aria-busy={
                    filterInputsPending ||
                    (assetsQuery.isFetching && !assetsQuery.isFetchingNextPage)
                  }
                  data-bidirectional={Boolean(browserCursor)}
                  onClick={() => clearAssetSelection()}
                  onScroll={(event) => assetViewport.handleScroll(event.currentTarget.scrollTop)}
                >
                  <div className={styles.scrollContent}>
                    {assetsQuery.isFetchPreviousPageError && (
                      <button type="button" onClick={loadPreviousPage}>
                        {t('重试')}
                      </button>
                    )}
                    {assetsQuery.isLoading && (
                      <div
                        className={styles.loadingGrid}
                        role="status"
                        aria-label={
                          libraryMode === 'PHOTO' ? t('正在加载照片…') : t('正在加载素材…')
                        }
                      >
                        {Array.from({ length: 12 }, (_, index) => (
                          <div key={index} className={styles.loadingTile} aria-hidden="true" />
                        ))}
                      </div>
                    )}
                    {assetsQuery.isError && (
                      <div className={styles.emptyState}>
                        {' ' + t('加载失败：')}
                        {assetsQuery.error.message}
                        <button type="button" onClick={() => void assetsQuery.refetch()}>
                          {' ' + t('重试') + ' '}
                        </button>
                      </div>
                    )}
                    {!assetsQuery.isLoading &&
                    !assetsQuery.isError &&
                    assets.length === 0 &&
                    activeSmartFolder?.semanticState &&
                    !activeSmartFolder.semanticState.hasResults &&
                    activeSmartFolder.semanticState.status !== 'READY' ? (
                      <div className={styles.emptyState}>
                        {activeSmartFolder.semanticState.status === 'FAILED'
                          ? t('匹配生成失败，请重试。')
                          : t('正在生成匹配结果…')}
                      </div>
                    ) : null}
                    {!assetsQuery.isLoading &&
                      !assetsQuery.isError &&
                      assets.length === 0 &&
                      !(
                        activeSmartFolder?.semanticState &&
                        !activeSmartFolder.semanticState.hasResults &&
                        activeSmartFolder.semanticState.status !== 'READY'
                      ) && (
                        <div className={styles.emptyState}>
                          <span className={styles.emptyMark}>
                            <img src={sekerEagleLogo} alt="" />
                          </span>
                          <strong>
                            {search || activeFilterCount || activeSmartFolderId
                              ? libraryMode === 'PHOTO'
                                ? t('没有匹配的照片')
                                : t('没有匹配的素材')
                              : libraryView === 'TRASH'
                                ? t('回收站是空的')
                                : libraryView === 'PRIVATE'
                                  ? t('暂无隐私素材')
                                  : libraryMode === 'PHOTO'
                                    ? t('暂无照片')
                                    : t('把第一份灵感放进来')}
                          </strong>
                          <p>
                            {search || activeFilterCount || activeSmartFolderId
                              ? t('尝试其他名称或标签。')
                              : libraryView === 'TRASH'
                                ? t('移除的素材会暂时保留在这里。')
                                : libraryView === 'PRIVATE'
                                  ? t('为素材添加已配置的私密标签。')
                                  : libraryMode === 'PHOTO'
                                    ? t('将照片拖入此处。')
                                    : t('将图片、RAW 或相机视频拖入此处。')}
                          </p>
                          {(search || activeFilterCount || activeSmartFolderId) && (
                            <button
                              type="button"
                              onClick={() => {
                                setSearch('');
                                setQuickFilters(createEmptyEagleQuickFilterState());
                                setActiveSmartFolderId(null);
                              }}
                            >
                              {t('清除搜索与筛选')}
                            </button>
                          )}
                        </div>
                      )}
                    <div
                      ref={masonryRef}
                      className={styles.masonry}
                      data-layout={compact ? 'square' : isPhotoTimeline ? 'justified' : 'masonry'}
                      style={{ height: masonryLayout.height }}
                    >
                      {visibleSections.map((section) => (
                        <h2
                          key={section.id}
                          className={styles.timelineSection}
                          style={{ top: section.top, height: section.height, width: section.width }}
                        >
                          <time dateTime={section.key}>
                            {compact
                              ? formatPhotoTimelineDay(section.key)
                              : formatPhotoTimelineMonth(section.key)}
                          </time>
                        </h2>
                      ))}
                      {visibleMasonryItems.map((masonryItem) => {
                        const asset = assetsById.get(masonryItem.id);
                        if (!asset) return null;
                        return (
                          <EagleAssetCard
                            key={asset.id}
                            asset={asset}
                            stack={photoStacksByCover.get(asset.id)}
                            selected={selectedAssetSet.has(asset.id)}
                            disabled={filterInputsPending || assetsQuery.isPlaceholderData}
                            selectionMode={selectionMode}
                            batchSelection={isBatchSelection}
                            dragEnabled={Boolean(desktopAssetDragBridge) && libraryView !== 'TRASH'}
                            libraryMode={libraryMode}
                            layout={masonryItem}
                            scheduler={thumbnailScheduler}
                            loadService={thumbnailLoadService}
                            actions={cardActions}
                          />
                        );
                      })}
                    </div>
                    <div ref={pageSentinelRef} className={styles.pageSentinel} aria-hidden="true" />
                    {assetsQuery.isFetchingNextPage && (
                      <div className={styles.pageLoading}>{t('正在加载更多素材…')}</div>
                    )}
                  </div>
                  {hasTimelineNavigation && (
                    <div
                      className={styles.timelineNavigation}
                      style={{ height: Math.max(80, viewportHeight - 28) }}
                    >
                      <PhotoTimelineRail
                        months={timelineIndex.data?.months ?? []}
                        loading={timelineIndex.isLoading}
                        error={timelineIndex.isError}
                        onRetry={() => void timelineIndex.refetch()}
                        currentMonth={(() => {
                          const first = visibleMasonryItems.find(
                            (item) => item.top + item.height > scrollTop,
                          );
                          const asset = first ? assetsById.get(first.id) : undefined;
                          return asset ? getPhotoTimelineMonth(asset) : undefined;
                        })()}
                        onLatest={() => {
                          assetLocator.clearLocation();
                          setTimelineCursor('');
                          assetViewport.elementRef.current?.scrollTo({ top: 0 });
                        }}
                        onJump={(month) => {
                          assetLocator.clearLocation();
                          setTimelineCursor(month.cursor);
                          assetViewport.elementRef.current?.scrollTo({ top: 0 });
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        {isInspectorOpen && (
          <EagleResponsiveDetails
            label={libraryMode === 'PHOTO' ? t('照片详情') : t('素材详情')}
            onClose={() => setIsInspectorVisible(false)}
          >
            <aside
              className={styles.inspector}
              aria-label={libraryMode === 'PHOTO' ? t('照片详情') : t('素材详情')}
            >
              <div className={styles.inspectorHeader}>
                <div>
                  <strong>{libraryMode === 'PHOTO' ? t('照片详情') : t('素材详情')}</strong>
                  {selectedAssetIds.length > 1 && (
                    <span>
                      {t('已选择') + ' '}
                      {selectedAssetIds.length}
                      {' ' + t('项')}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={libraryMode === 'PHOTO' ? t('关闭照片详情') : t('关闭素材详情')}
                  onClick={() => setIsInspectorVisible(false)}
                >
                  <IconX size={17} />
                </button>
              </div>
              {selectedAssetId === null ? (
                <div className={styles.inspectorEmpty}>
                  <IconPhoto size={28} />
                  <span>
                    {libraryMode === 'PHOTO'
                      ? t('选择一张照片查看详情')
                      : t('选择一项素材查看详情')}
                  </span>
                </div>
              ) : selectedAssetQuery.isPending ? (
                <div className={styles.inspectorEmpty} role="status">
                  <IconPhoto size={28} />
                  <span>
                    {libraryMode === 'PHOTO' ? t('正在加载照片详情…') : t('正在加载素材详情…')}
                  </span>
                </div>
              ) : selectedAssetQuery.isError ? (
                <div className={styles.inspectorEmpty} role="alert">
                  <IconPhoto size={28} />
                  <span>
                    {t('加载失败：')}
                    {selectedAssetQuery.error.message}
                  </span>
                  <button type="button" onClick={() => void selectedAssetQuery.refetch()}>
                    {' ' + t('重试加载素材详情') + ' '}
                  </button>
                </div>
              ) : selectedAsset ? (
                <>
                  {!isSelectedAssetReadOnly && selectedAssetIds.length === 1 && (
                    <section className={styles.detailSection}>
                      <EagleEditPhotoButton asset={selectedAsset} onEdit={openPhotoEditor} />
                    </section>
                  )}
                  {libraryMode === 'PHOTO' && (
                    <PhotoMetadataDetails
                      metadata={selectedAsset.photoMetadata}
                      location={selectedAsset.photoLocation}
                    />
                  )}
                  {isSelectedAssetReadOnly && (
                    <p className={styles.saveFeedback}>{t('回收站中的素材信息为只读。')}</p>
                  )}
                  <section className={styles.detailSection}>
                    <div className={styles.annotationForm}>
                      <label>
                        {' ' + t('标题') + ' '}
                        <input
                          aria-label={t('素材标题')}
                          maxLength={255}
                          disabled={isSelectedAssetReadOnly}
                          value={metadataDraft.values.displayName}
                          onChange={(event) => {
                            metadataDraft.change('displayName', event.target.value);
                          }}
                          onBlur={saveEditedMetadata}
                        />
                      </label>
                    </div>
                  </section>
                  <section className={styles.detailSection}>
                    <h3>{selectedAssetIds.length > 1 ? t('批量编辑人工标签') : t('人工标签')}</h3>
                    {selectedAssetIds.length > 1 && (
                      <p className={styles.batchTagSummary}>
                        {' ' +
                          t('标签后的数字表示拥有该标签的素材数；移除操作会作用于全部所选素材。') +
                          ' '}
                      </p>
                    )}
                    <div className={styles.tagEditor}>
                      {selectedManualTagSummaries.map(({ tag, assetCount }) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={styles.tagAssigned}
                          aria-label={
                            selectedAssetIds.length > 1
                              ? t('移除人工标签 {{value1}}，应用于 {{value2}}/{{value3}} 项素材', {
                                  value1: tag.name,
                                  value2: assetCount,
                                  value3: selectedAssetIds.length,
                                })
                              : t('移除人工标签 {{value1}}', {
                                  value1: tag.name,
                                })
                          }
                          disabled={isSelectedAssetReadOnly || batchTagMutation.isPending}
                          onClick={() =>
                            batchTagMutation.mutate({
                              assetIds: selectedAssetIds,
                              removeTagIds: [tag.id],
                            })
                          }
                        >
                          {tag.name}
                          {selectedAssetIds.length > 1
                            ? ` · ${assetCount}/${selectedAssetIds.length}`
                            : ''}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={styles.tagAdd}
                        aria-label={t('添加人工标签')}
                        disabled={isSelectedAssetReadOnly}
                        onClick={() => {
                          batchTagMutation.reset();
                          createBatchTagMutation.reset();
                          setTagPicker({ mode: 'add', assetIds: [...selectedAssetIds] });
                        }}
                      >
                        <IconPlus size={14} />
                        {' ' + t('添加标签…') + ' '}
                      </button>
                      {selectedAssetIds.length > 1 && selectedManualTagSummaries.length > 0 && (
                        <button
                          type="button"
                          className={styles.tagClearAll}
                          aria-label={t('清空所有人工标签')}
                          disabled={isSelectedAssetReadOnly || batchTagMutation.isPending}
                          onClick={() => {
                            const confirmed = window.confirm(
                              t(
                                '将清除 {{value1}} 项素材上的全部人工标签，共涉及 {{value2}} 个不同标签。AI 自动标签不受影响。确认继续？',
                                {
                                  value1: selectedAssetIds.length,
                                  value2: selectedManualTagSummaries.length,
                                },
                              ),
                            );
                            if (!confirmed) return;
                            batchTagMutation.mutate({
                              assetIds: selectedAssetIds,
                              clearAll: true,
                            });
                          }}
                        >
                          <IconTrash size={14} />
                          {' ' + t('清空所有人工标签') + ' '}
                        </button>
                      )}
                    </div>
                    {batchTagMutation.isError && (
                      <p className={styles.inlineError}>{batchTagMutation.error.message}</p>
                    )}
                  </section>
                  <form
                    ref={metadataFormRef}
                    id="eagle-asset-metadata-form"
                    className={`${styles.detailSection} ${styles.annotationForm}`}
                  >
                    {selectedAsset?.isPrivate && (
                      <div role="note">
                        <strong>{t('私密原因')}</strong>
                        {selectedAsset.privacyReasons?.length ? (
                          <ul>
                            {selectedAsset.privacyReasons.map((reason) => (
                              <li key={`${reason.kind}:${reason.id}`}>
                                {reason.kind === 'TAG' ? t('私密标签') : t('私密人物')}
                                {': '}
                                {reason.name ?? t('未命名人物')}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>{t('关联照片的私密规则')}</p>
                        )}
                      </div>
                    )}
                    <label>
                      {' ' + t('描述') + ' '}
                      <textarea
                        aria-label={t('素材描述')}
                        maxLength={4000}
                        disabled={isSelectedAssetReadOnly}
                        rows={4}
                        value={metadataDraft.values.description}
                        onChange={(event) => {
                          metadataDraft.change('description', event.target.value);
                        }}
                        onBlur={saveEditedMetadata}
                      />
                    </label>
                    <label>
                      {' ' + t('来源') + ' '}
                      <input
                        aria-label={t('素材来源链接')}
                        maxLength={2048}
                        disabled={isSelectedAssetReadOnly}
                        placeholder="https://"
                        type="url"
                        value={metadataDraft.values.sourceUrl}
                        onChange={(event) => {
                          metadataDraft.change('sourceUrl', event.target.value);
                        }}
                        onBlur={(event) => {
                          if (event.currentTarget.checkValidity()) saveEditedMetadata();
                        }}
                      />
                    </label>
                  </form>
                  {metadataMutation.isPending && (
                    <p className={styles.saveFeedback} role="status">
                      {' ' + t('正在自动保存…') + ' '}
                    </p>
                  )}
                  {metadataMutation.isSuccess && !metadataDraft.dirty && (
                    <p className={styles.saveFeedback} role="status">
                      {' ' + t('已自动保存') + ' '}
                    </p>
                  )}
                  {metadataMutation.isError && (
                    <div className={styles.saveFeedback}>
                      <p className={styles.inlineError} role="alert">
                        {' ' + t('自动保存失败：')}
                        {metadataMutation.error.message}
                      </p>
                      <button type="button" onClick={saveEditedMetadata}>
                        {' ' + t('重试') + ' '}
                      </button>
                    </div>
                  )}
                  <section className={styles.detailSection}>
                    <h3>{t('星级')}</h3>
                    <div className={styles.rating} aria-label={t('星级评分')}>
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          type="button"
                          aria-label={t('{{value1}} 星', {
                            value1: rating,
                          })}
                          disabled={isSelectedAssetReadOnly || ratingMutation.isPending}
                          aria-busy={pendingRating === rating}
                          onClick={() =>
                            ratingMutation.mutate({
                              assets: selectedAssetVersions,
                              rating: selectedRating === rating ? null : rating,
                            })
                          }
                        >
                          {selectedRating && selectedRating >= rating ? (
                            <IconStarFilled size={19} />
                          ) : (
                            <IconStar size={19} />
                          )}
                          {pendingRating === rating && (
                            <IconLoader2 className={styles.ratingPending} size={10} />
                          )}
                        </button>
                      ))}
                    </div>
                    {ratingMutation.isError && (
                      <p className={styles.inlineError} role="alert">
                        {t('保存失败，请重试。')}
                      </p>
                    )}
                  </section>
                  <section className={styles.detailSection}>
                    <div className={styles.annotationForm}>
                      <h3>{t('颜色')}</h3>
                      <EagleColorPalette
                        analysis={selectedAsset.colorAnalysis}
                        onSelectColor={(nextColor) => {
                          changeLibraryView('ACTIVE');
                          setQuickFilters({
                            ...createEmptyEagleQuickFilterState(),
                            color: nextColor,
                          });
                        }}
                      />
                    </div>
                  </section>
                  <section className={styles.detailSection}>
                    <h3>{t('完整属性')}</h3>
                    <dl>
                      <div>
                        <dt>{t('原始文件名')}</dt>
                        <dd>{selectedAsset.originalName}</dd>
                      </div>
                      <div>
                        <dt>{t('格式')}</dt>
                        <dd>{selectedAsset.format.toUpperCase()}</dd>
                      </div>
                      <div>
                        <dt>MIME</dt>
                        <dd>{selectedAsset.mimeType}</dd>
                      </div>
                      <div>
                        <dt>{t('尺寸')}</dt>
                        <dd>
                          {selectedAsset.width && selectedAsset.height
                            ? `${selectedAsset.width} × ${selectedAsset.height}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('时长')}</dt>
                        <dd>
                          {selectedAsset.durationMs
                            ? t('{{value1}} 秒', {
                                value1: (selectedAsset.durationMs / 1000).toFixed(1),
                              })
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('大小')}</dt>
                        <dd>{formatBytes(selectedAsset.byteSize)}</dd>
                      </div>
                      <div>
                        <dt>{t('处理状态')}</dt>
                        <dd>
                          {selectedAsset.lifecycleStatus === 'READY'
                            ? t('可用')
                            : selectedAsset.lifecycleStatus === 'FAILED'
                              ? t('失败')
                              : t('处理中')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('添加时间')}</dt>
                        <dd>
                          {new Date(selectedAsset.libraryAddedAt).toLocaleString(getLocale())}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('更新时间')}</dt>
                        <dd>{new Date(selectedAsset.updatedAt).toLocaleString(getLocale())}</dd>
                      </div>
                      <div>
                        <dt>{t('素材 ID')}</dt>
                        <dd>{selectedAsset.id}</dd>
                      </div>
                    </dl>
                  </section>
                </>
              ) : (
                <div className={styles.inspectorEmpty}>
                  <IconPhoto size={28} />
                  <span>
                    {libraryMode === 'PHOTO'
                      ? t('选择一张照片查看详情')
                      : t('选择一项素材查看详情')}
                  </span>
                </div>
              )}
            </aside>
          </EagleResponsiveDetails>
        )}
      </div>

      {assetContextMenu && selectedAssetIds.length > 0 && (
        <EagleAssetActionMenu
          position={assetContextMenu}
          count={selectedAssetIds.length}
          onClose={() => setAssetContextMenu(null)}
        >
          {libraryView !== 'TRASH' && selectedTransferAssets.length === selectedAssetIds.length && (
            <EagleFavoriteButton assets={selectedTransferAssets} role="menuitem" />
          )}
          {libraryView !== 'TRASH' &&
            selectedTransferAssets.length === selectedAssetIds.length &&
            selectedTransferAssets.every((asset) => asset.mimeType.startsWith('image/')) && (
              <EagleSendAssetsMenuItem
                key={selectedAssetMenuKey}
                assetIds={selectedAssetIds}
                label={libraryMode === 'PHOTO' ? t('发送到素材') : t('发送到照片')}
                disabled={selectedTransferAssets.some((asset) => asset.lifecycleStatus !== 'READY')}
                onQueued={() => {
                  clearAssetSelection();
                }}
              />
            )}
          {contextMenuAsset && libraryView !== 'TRASH' && (
            <EagleEditPhotoButton
              asset={contextMenuAsset}
              onEdit={openPhotoEditor}
              role="menuitem"
            />
          )}
          {contextMenuAsset && libraryView !== 'TRASH' ? (
            <button
              type="button"
              role="menuitem"
              aria-label={t('另存为…')}
              disabled={assetActionPending !== null}
              onClick={saveSelectedOriginal}
            >
              <IconDownload size={15} />
              {assetActionPending === 'save' ? t('正在准备…') : t('另存为…')}
            </button>
          ) : null}
          {imageClipboardAvailable &&
          contextMenuAsset?.mimeType.startsWith('image/') &&
          getEaglePreviewContentUrl(contextMenuAsset) ? (
            <button
              type="button"
              role="menuitem"
              aria-label={t('复制图片')}
              disabled={assetActionPending !== null}
              onClick={copySelectedImage}
            >
              <IconCopy size={15} />
              {assetActionPending === 'copy' ? t('正在准备 4K…') : t('复制图片')}
            </button>
          ) : null}
          {selectedAssetIds.length > 1 && libraryView !== 'TRASH' ? (
            <button
              type="button"
              role="menuitem"
              aria-label={t('批量下载（{{value1}}）…', {
                value1: selectedAssetIds.length,
              })}
              disabled={isBatchDownloading}
              onClick={batchDownloadSelectedOriginals}
            >
              <IconDownload size={15} />
              {isBatchDownloading
                ? t('正在下载 {{value1}} 项…', {
                    value1: selectedAssetIds.length,
                  })
                : t('批量下载（{{value1}}）…', {
                    value1: selectedAssetIds.length,
                  })}
            </button>
          ) : null}
          {(libraryView === 'ACTIVE' || libraryView === 'PRIVATE') && (
            <button
              type="button"
              role="menuitem"
              aria-label={t('添加标签')}
              disabled={batchTagMutation.isPending}
              onClick={() => {
                setAssetContextMenu(null);
                batchTagMutation.reset();
                createBatchTagMutation.reset();
                setTagPicker({ mode: 'add', assetIds: [...selectedAssetIds] });
              }}
            >
              <IconTags size={15} />
              {' ' + t('添加标签…') + ' '}
            </button>
          )}
          {(libraryView === 'ACTIVE' || libraryView === 'PRIVATE') && (
            <button
              type="button"
              role="menuitem"
              aria-label={t('删除人工标签')}
              disabled={batchTagMutation.isPending || selectedManualTagSummaries.length === 0}
              onClick={() => {
                setAssetContextMenu(null);
                batchTagMutation.reset();
                setTagPicker({ mode: 'remove', assetIds: [...selectedAssetIds] });
              }}
            >
              <IconTagsOff size={15} />
              {' ' + t('删除人工标签…') + ' '}
            </button>
          )}
          {libraryView === 'ACTIVE' || libraryView === 'PRIVATE' ? (
            <button
              data-menu-danger
              type="button"
              role="menuitem"
              aria-label={t('删除所选素材')}
              disabled={trashMutation.isPending}
              onClick={() => trashMutation.mutate(selectedAssetIds)}
            >
              <IconTrash size={15} />
              {' ' + t('删除（移到回收站）') + ' '}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              aria-label={t('恢复所选素材')}
              disabled={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(selectedAssetIds)}
            >
              <IconRefresh size={15} />
              {' ' + t('恢复') + ' '}
            </button>
          )}
          {assetActionError ? <div role="alert">{assetActionError}</div> : null}
        </EagleAssetActionMenu>
      )}

      {failedAssetAction && (
        <EagleConfirmationDialog
          title={t('处理失败')}
          description={
            <>
              {mediaProcessingFailure(failedAssetAction.mediaErrorCode).detail}
              {failedAssetError ? <div role="alert">{failedAssetError}</div> : null}
            </>
          }
          actions={
            <>
              {mediaProcessingFailure(failedAssetAction.mediaErrorCode).retryable && (
                <button
                  type="button"
                  disabled={retryAssetProcessingMutation.isPending}
                  onClick={() => retryAssetProcessingMutation.mutate(failedAssetAction.id)}
                >
                  {t('重试处理')}
                </button>
              )}
              <button
                type="button"
                disabled={trashMutation.isPending}
                onClick={() => {
                  trashMutation.mutate([failedAssetAction.id]);
                  setFailedAssetAction(null);
                }}
              >
                {t('删除（移到回收站）')}
              </button>
              <button type="button" onClick={() => setFailedAssetAction(null)}>
                {t('关闭')}
              </button>
            </>
          }
          onCancel={() => setFailedAssetAction(null)}
        />
      )}

      {confirmEmptyTrash && (
        <EagleTrashConfirmation
          mode={libraryMode}
          onClose={() => setConfirmEmptyTrash(false)}
          onConfirm={() => {
            setConfirmEmptyTrash(false);
            emptyTrashMutation.mutate();
          }}
        />
      )}
      {tagPicker && tagPicker.assetIds.length > 0 && (
        <EagleBatchTagPicker
          mode={tagPicker.mode}
          assetCount={tagPicker.assetIds.length}
          tags={tagPicker.mode === 'remove' ? removableManualTags : manualTags}
          selectedAssetCountByTagId={
            tagPicker.mode === 'remove' ? selectedAssetCountByTagId : undefined
          }
          pending={batchTagMutation.isPending}
          error={
            (
              batchTagMutation.error ??
              (tagPicker.mode === 'add' ? createBatchTagMutation.error : null)
            )?.message
          }
          onCreate={
            tagPicker.mode === 'add'
              ? (name) => createBatchTagMutation.mutateAsync(name)
              : undefined
          }
          onClose={() => setTagPicker(null)}
          onApply={(tagIds) =>
            batchTagMutation.mutate({
              assetIds: tagPicker.assetIds,
              addTagIds: tagPicker.mode === 'add' ? tagIds : [],
              removeTagIds: tagPicker.mode === 'remove' ? tagIds : [],
            })
          }
        />
      )}

      <EagleDownloadQueue queue={workspaceCache.downloads} />
      {isDragging && (
        <div className={styles.dropOverlay}>
          <IconPlus size={32} />
          <strong>{t('松手导入素材')}</strong>
          <span>{t('支持批量图片和 MP4')}</span>
        </div>
      )}
      {previewStack ? (
        <PhotoStackLightbox
          key={previewStack.id}
          stack={previewStack}
          onEdit={libraryView === 'TRASH' ? undefined : openPhotoEditor}
          onLocate={libraryView === 'TRASH' ? undefined : assetLocator.locate}
          onClose={imagePreview.closePreview}
        />
      ) : (
        previewAsset && (
          <EagleAssetLightbox
            asset={previewAsset}
            onEdit={libraryView === 'TRASH' ? undefined : openPhotoEditor}
            onLocate={libraryView === 'TRASH' ? undefined : assetLocator.locate}
            onClose={imagePreview.closePreview}
          />
        )
      )}
      {imagePreview.previewImage ? (
        <EagleImageViewer
          asset={previewImageAsset ?? undefined}
          readOnly={libraryView === 'TRASH'}
          image={imagePreview.previewImage}
          loadingPlaceholder={
            previewImageAsset ? (
              <CachedEagleAssetThumbnail
                asset={previewImageAsset}
                loadService={thumbnailLoadService}
                displayWidth={thumbnailSize}
              />
            ) : undefined
          }
          subtitle={previewImageAsset ? eagleViewerMetadata(previewImageAsset) : undefined}
          navigation={previewNavigation}
          descriptor={previewPyramidQuery.data}
          previewLimited={previewImageAsset ? eaglePreviewIsLimited(previewImageAsset) : false}
          highResolutionSrc={
            previewImageAsset ? getEagleViewerHighResolutionUrl(previewImageAsset) : undefined
          }
          editLabel={previewImageAsset ? eaglePhotoEditLabel(previewImageAsset) : undefined}
          onEdit={
            libraryView !== 'TRASH' &&
            previewImageAsset &&
            getEagleEditContentUrl(previewImageAsset)
              ? () => openPhotoEditor(previewImageAsset)
              : undefined
          }
          onLocate={libraryView === 'TRASH' ? undefined : assetLocator.locate}
          onClose={imagePreview.closePreview}
        />
      ) : null}
      {batchEditIds && photoEditing.clipboard && (
        <AsyncViewBoundary>
          <EagleBatchPhotoEdit
            key={editingScope}
            assetIds={batchEditIds}
            recipe={photoEditing.clipboard}
            resolveSession={photoEditing.resolveSession}
            onClose={() => setBatchEditIds(null)}
          />
        </AsyncViewBoundary>
      )}
      <EaglePhotoEditorDialog
        session={photoEditing.session}
        onClose={photoEditing.close}
        onOpenSaved={assetLocator.locate}
      />
      {isSmartFolderDialogOpen && (
        <EagleSmartFolderDialog
          key={editingScope}
          fieldOptions={photoFieldOptions.fieldOptions}
          fieldOptionsAction={peopleOptionsAction}
          initialQuery={
            editingSmartFolder
              ? toEagleFilterQuery(editingSmartFolder.queryJson)
              : buildEagleQuickFilterQuery(quickFilters)
          }
          initialName={editingSmartFolder?.name}
          mode={editingSmartFolder ? 'edit' : 'create'}
          manualTags={manualTags}
          pending={smartFolderMutation.isPending || updateSmartFolderMutation.isPending}
          error={
            (editingSmartFolder ? updateSmartFolderMutation.error : smartFolderMutation.error)
              ?.message
          }
          onClose={() => {
            setIsSmartFolderDialogOpen(false);
            setEditingSmartFolder(null);
          }}
          onSave={(input) =>
            editingSmartFolder
              ? updateSmartFolderMutation.mutate({ folder: editingSmartFolder, changes: input })
              : smartFolderMutation.mutate(input)
          }
        />
      )}
      {duplicatesOpen && (
        <EagleDuplicates
          key={editingScope}
          scopeRevision={editingScope}
          includePrivate={privateVisible}
          onClose={() => setDuplicatesOpen(false)}
        />
      )}
    </main>
  );
}
