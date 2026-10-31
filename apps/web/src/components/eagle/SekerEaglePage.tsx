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
import { EagleStackBadge } from './EagleStackBadge';
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
import { isCameraVideoMime } from '@sekereagle/library-core';
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
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  hashKey,
  useInfiniteQuery,
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
  IconLock,
  IconPhoto,
  IconMapPin,
  IconUsers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconTagsOff,
  IconTags,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import sekerEagleLogo from '../../assets/seker-eagle-logo.svg';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useImagePreviewState } from '../media/image-preview/useImagePreviewState';
import {
  type EagleAsset,
  type EagleAssetListItem,
  type EagleAssetFilters,
  type EagleAssetChanges,
  type EagleAssetVersion,
  type EagleManualTag,
  type EagleSmartFolder,
} from '../../lib/eagle-api';
import type { PrivacyVisibilityState } from '../../lib/privacy-visibility-api';
import { canCopyImageToClipboard, copyImageToClipboard } from '../../lib/image-clipboard';
import { EagleDownloadQueue } from './EagleDownloadQueue';
import { downloadOriginalFiles, saveOriginalFile } from '../../lib/original-file-export';

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
import { CachedEagleAssetThumbnail, EagleAssetThumbnail } from './EagleAssetThumbnail';
import {
  getEaglePreviewContentUrl,
  getEagleEditContentUrl,
  getEagleLivePhotoContentUrl,
  collapseLivePhotoComponents,
  needsEagleImagePyramid,
} from './eagle-media-sources';
import { EagleBatchTagPicker } from './EagleBatchTagPicker';
import { EagleColorPalette } from './EagleColorPalette';
import type { EagleVectorWorkspaceView } from './EagleVectorWorkspace';
import { EagleSmartFolderDialog } from './EagleSmartFolderDialog';
import { EagleSmartFolderTree } from './EagleSmartFolderTree';
import {
  EagleQuickFilterBar,
  buildEagleQuickFilterQuery,
  countActiveEagleQuickFilters,
  createEmptyEagleQuickFilterState,
} from './EagleQuickFilterBar';
import { EagleTagPage } from './EagleTagPage';
import { useEagleMasonryLayout } from './eagle-masonry-layout';
import { applyEagleSelection, type EagleSelectionGesture } from './eagle-selection';
import { getAssetDragIds, getDesktopAssetDragBridge } from './eagle-asset-drag';
import { DesktopAssetDragSession, type DesktopAssetDragStatus } from './eagle-asset-drag-session';
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
  accessToken?: string;
  ownerId: string;
  canManageProcessing?: boolean;
  accountView?: ReactNode;
  accountSummary?: { email: string; onLogout: () => void };
  privacyVisibility?: PrivacyVisibilityState;
  privacyRulesRevision?: number;
  onPrivacyRulesChange?: () => void;
}
type EagleAssetContextMenu = {
  x: number;
  y: number;
};
type EagleTagPickerState = {
  mode: 'add' | 'remove';
  assetIds: string[];
};
type EagleWorkspaceSection = 'TAGS' | 'PENDING' | 'SETTINGS' | 'TASKS';

function getWorkspaceSection(view: EagleLibraryView): EagleWorkspaceSection | null {
  if (view === 'MANUAL_TAGS' || view === 'AI_TAGS') return 'TAGS';
  if (view === 'PROCESSING') return 'TASKS';
  if (view === 'VECTOR_REVIEW' || view === 'VECTOR_UNCLASSIFIED') {
    return 'PENDING';
  }
  if (view === 'VECTOR_TAGS' || view === 'ACCOUNT') {
    return 'SETTINGS';
  }
  return null;
}

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
const EAGLE_PREFERENCES_KEY = 'seker-eagle.preferences.v1';
const DEFAULT_THUMBNAIL_SIZE = 210;
function readThumbnailSize(preferencesKey = EAGLE_PREFERENCES_KEY): number {
  try {
    const preferences: unknown = JSON.parse(window.localStorage.getItem(preferencesKey) ?? '{}');
    const value =
      typeof preferences === 'object' && preferences !== null && 'thumbnailSize' in preferences
        ? preferences.thumbnailSize
        : undefined;
    return typeof value === 'number' && value >= 140 && value <= 320
      ? value
      : DEFAULT_THUMBNAIL_SIZE;
  } catch {
    return DEFAULT_THUMBNAIL_SIZE;
  }
}
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer?.types?.includes('Files') === true;
}
export function SekerEaglePage({
  modeSwitcher,
  accessToken: providedAccessToken,
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
  const preferencesKey = `${EAGLE_PREFERENCES_KEY}:${storeScope}`;
  const {
    api: {
      getEagleAsset,
      getEagleAssetLocation,
      getEagleTrashAsset,
      getEaglePyramidDescriptor,
      listEagleAssets,
      listEagleTrash,
      fetchEagleVectorSummary,
    },
  } = useLibraryWorkspace();

  const accessToken = providedAccessToken ?? '';
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
  const backgroundChanges = useSyncExternalStore(
    workspaceCache.subscribeBackgroundChanges,
    workspaceCache.hasBackgroundChanges,
    workspaceCache.hasBackgroundChanges,
  );
  const thumbnailLoadService = workspaceCache.thumbnails;
  const pageSentinelRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const importDragActiveRef = useRef(false);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const editorAssetIdRef = useRef<string | null>(null);
  const editorDirtyRef = useRef(false);
  const editorDirtyFieldsRef = useRef<Set<keyof EagleAssetChanges>>(new Set());
  const editorRevisionRef = useRef(0);
  const privacyStateRef = useRef(
    `${privacyVisibility?.enabled === true}:${privacyVisibility?.expiresAt ?? ''}:${privacyRulesRevision}`,
  );
  const metadataFormRef = useRef<HTMLFormElement>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [photoView, setPhotoView] = useState<EaglePhotoView>(() =>
    !privateVisible ? (workspaceCache.browse?.photoView ?? 'timeline') : 'timeline',
  );
  const [search, setSearch] = useState(() =>
    privateVisible ? '' : (workspaceCache.browse?.search ?? ''),
  );
  const [libraryView, setLibraryView] = useState<EagleLibraryView>(() => {
    const saved = !privateVisible ? workspaceCache.browse?.libraryView : undefined;
    return saved && saved !== 'PRIVATE' ? saved : 'ACTIVE';
  });
  const [aiTagReferenceRequested, setAiTagReferenceRequested] = useState(false);
  const [smartFolderOrder, setSmartFolderOrder] = useState<'DATE' | 'RELEVANCE'>(() =>
    privateVisible ? 'DATE' : (workspaceCache.browse?.smartFolderOrder ?? 'DATE'),
  );
  const [activeSmartFolderId, setActiveSmartFolderId] = useState<string | null>(() =>
    privateVisible ? null : (workspaceCache.browse?.activeSmartFolderId ?? null),
  );
  const [isSmartFolderDialogOpen, setIsSmartFolderDialogOpen] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<EagleSmartFolder | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [previewContext, setPreviewContext] = useState<{
    scope: string;
    items: EagleAssetListItem[];
  } | null>(null);
  const [isBatchSelection, setIsBatchSelection] = useState(
    () => !privateVisible && (workspaceCache.browse?.isBatchSelection ?? false),
  );
  const compact = useCompactLayout();
  const [mobileMore, setMobileMore] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [selectionMode, setSelectionMode] = useState(
    () => !privateVisible && (workspaceCache.browse?.selectionMode ?? false),
  );
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(() =>
    !privateVisible ? [...(workspaceCache.browse?.selectedAssetIds ?? [])] : [],
  );
  const [assetContextMenu, setAssetContextMenu] = useState<EagleAssetContextMenu | null>(null);
  const [tagPicker, setTagPicker] = useState<EagleTagPickerState | null>(null);
  const deferredSearch = useDebouncedValue(search.normalize('NFKC').trim(), 250);
  const [quickFilters, setQuickFilters] = useState(
    () =>
      (!privateVisible && workspaceCache.browse?.quickFilters) ||
      createEmptyEagleQuickFilterState(),
  );
  const deferredQuickFilters = useDebouncedValue(quickFilters, 150);
  const filterInputsPending =
    hashKey([quickFilters]) !== hashKey([deferredQuickFilters]) ||
    search.normalize('NFKC').trim() !== deferredSearch;
  const [filtersExpanded, setFiltersExpanded] = useState(
    () => !privateVisible && (workspaceCache.browse?.filtersExpanded ?? false),
  );
  const filterPanelId = useId();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(() =>
    !privateVisible ? (workspaceCache.browse?.selectedAssetId ?? null) : null,
  );
  const [isInspectorVisible, setIsInspectorVisible] = useState(
    () => !privateVisible && (workspaceCache.browse?.isInspectorVisible ?? false),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [originalFileError, setOriginalFileError] = useState<string | null>(null);
  const [assetDragStatus, setAssetDragStatus] = useState<DesktopAssetDragStatus>(null);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [assetActionPending, setAssetActionPending] = useState<'copy' | 'save' | null>(null);
  const [assetActionError, setAssetActionError] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [thumbnailSize, setThumbnailSize] = useState(() => readThumbnailSize(preferencesKey));
  const [editorTitle, setEditorTitle] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorSourceUrl, setEditorSourceUrl] = useState('');
  const imagePreview = useImagePreviewState();
  const editingScope = `${storeScope}:${privateVisible}:${privacyVisibility?.expiresAt ?? ''}:${privacyRulesRevision}`;
  const photoEditing = useEaglePhotoEditing({
    accessToken,
    ownerId,
    scopeKey: editingScope,
  });
  const [batchEditIds, setBatchEditIds] = useState<string[] | null>(null);
  useEffect(() => setBatchEditIds(null), [editingScope]);
  const openPhotoEditor = (asset: EagleAssetListItem) => {
    setAssetContextMenu(null);
    photoEditing.open(asset);
  };
  const { importFiles, uploadStatus, uploads, dismissUploads, retryUpload } =
    useEagleUploadController(accessToken, queryKeys.assets);
  useEffect(() => {
    window.localStorage.setItem(preferencesKey, JSON.stringify({ thumbnailSize }));
  }, [thumbnailSize, preferencesKey]);
  useEffect(() => {
    setOriginalFileError(null);
    setTransferStatus(null);
    setAssetDragStatus(null);
    setAiTagReferenceRequested(false);
  }, [ownerId, libraryMode]);
  const workspaceSection = getWorkspaceSection(libraryView);
  const isAssetView =
    libraryView === 'ACTIVE' || libraryView === 'PRIVATE' || libraryView === 'TRASH';
  const showsAssetControls = libraryMode !== 'PHOTO' || photoView === 'timeline';
  const activeFilterCount = countActiveEagleQuickFilters(quickFilters);
  const appliedFilterCount = countActiveEagleQuickFilters(deferredQuickFilters);
  const filterQuery = useMemo(
    () => buildEagleQuickFilterQuery(deferredQuickFilters),
    [deferredQuickFilters],
  );
  const isPhotoTimeline =
    libraryMode === 'PHOTO' && photoView === 'timeline' && libraryView !== 'TRASH';
  const hasTimelineNavigation =
    isPhotoTimeline &&
    !compact &&
    libraryView === 'ACTIVE' &&
    !deferredSearch &&
    !activeFilterCount &&
    !activeSmartFolderId;
  const [timelineCursor, setTimelineCursor] = useState('');
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
      setPreviewAssetId(null);
      setPreviewContext(null);
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

  useEffect(() => {
    setTimelineCursor('');
  }, [
    deferredSearch,
    activeFilterCount,
    activeSmartFolderId,
    privateVisible,
    privacyRulesRevision,
    libraryView,
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
  useEffect(() => {
    if (!privateVisible && libraryView !== 'PRIVATE') {
      workspaceCache.browse = {
        search,
        quickFilters,
        activeSmartFolderId,
        smartFolderOrder,
        libraryView,
        photoView,
        filtersExpanded,
        selectedAssetIds,
        selectedAssetId,
        isInspectorVisible,
        isBatchSelection,
        selectionMode,
      };
    }
  }, [
    workspaceCache,
    privateVisible,
    libraryView,
    search,
    quickFilters,
    activeSmartFolderId,
    smartFolderOrder,
    photoView,
    filtersExpanded,
    selectedAssetIds,
    selectedAssetId,
    isInspectorVisible,
    isBatchSelection,
    selectionMode,
  ]);
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
      const pageFilters = { ...assetFilters, cursor: pageParam || undefined };
      const page =
        libraryView === 'TRASH'
          ? await listEagleTrash(accessToken, pageFilters, signal)
          : await listEagleAssets(accessToken, pageFilters, signal);
      signal.throwIfAborted();
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
  const selectionScope = hashKey([listIdentity, quickFilters, search]);
  const previousSelectionScope = useRef(selectionScope);
  useEffect(() => {
    if (previousSelectionScope.current === selectionScope) return;
    previousSelectionScope.current = selectionScope;
    setSelectedAssetId(null);
    setSelectedAssetIds([]);
    setAssetContextMenu(null);
    setIsBatchSelection(false);
    selectionAnchorIdRef.current = null;
  }, [selectionScope]);
  const secondaryReady = true;
  const { manualTagsQuery, manualTagGroupsQuery, aiTagsQuery, smartFoldersQuery } =
    useEagleReferenceData(accessToken, queryKeys, {
      enabled: secondaryReady,
      aiTagsEnabled:
        libraryView === 'AI_TAGS' || aiTagReferenceRequested || isSmartFolderDialogOpen,
    });
  useAssetOperationProgress(privateVisible, secondaryReady);
  const vectorSummaryQuery = useQuery({
    queryKey: [...queryKeys.root, 'vector-summary'],
    queryFn: fetchEagleVectorSummary,
    staleTime: 60_000,
    enabled: secondaryReady,
    refetchInterval:
      workspaceSection === 'PENDING' ? 10_000 : workspaceSection === 'SETTINGS' ? 30_000 : false,
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
    setPreviewAssetId(null);
    setPreviewContext(null);
    imagePreview.closePreview();
    setSelectedAssetIds([]);
    setSelectedAssetId(null);
    setIsBatchSelection(false);
    setSelectionMode(false);
    setAssetContextMenu(null);
    selectionAnchorIdRef.current = null;
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
    moveSmartFolderMutation,
  } = useEagleMutations(accessToken, queryKeys, {
    onMetadataSaved: (assetId, revision) => {
      if (editorAssetIdRef.current === assetId && editorRevisionRef.current === revision) {
        editorDirtyRef.current = false;
        editorDirtyFieldsRef.current.clear();
      }
    },
    onBatchTagsApplied: () => setTagPicker(null),
    onAssetPrivacyChanged: resetAssetPrivacyState,
    onOperationQueued: () => {
      setTransferStatus(t('已加入任务中心，可继续浏览。'));
      setPreviewAssetId(null);
      setPreviewContext(null);
      imagePreview.closePreview();
      setSelectedAssetIds([]);
      setSelectedAssetId(null);
      setIsBatchSelection(false);
      setSelectionMode(false);
      setAssetContextMenu(null);
      selectionAnchorIdRef.current = null;
    },
    onSmartFolderCreated: () => setIsSmartFolderDialogOpen(false),
    onSmartFolderUpdated: (folder, changes) => {
      setIsSmartFolderDialogOpen(false);
      setEditingSmartFolder(null);
      if (activeSmartFolderId !== folder.id || changes.name === undefined) return;
      setSearch('');
      setQuickFilters(createEmptyEagleQuickFilterState());
    },
  });
  const loadedAssets = useMemo(() => {
    const uniqueAssets = new Map<string, EagleAssetListItem>();
    assetsQuery.data?.pages.forEach((page) => {
      assetStore.getMany(page.assetIds).forEach((item) => uniqueAssets.set(item.id, item));
    });
    return [...uniqueAssets.values()];
  }, [assetStore, assetStoreRevision, assetsQuery.data]);
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
  const libraryCount = useEagleLibraryCount(
    accessToken,
    queryKeys,
    privateVisible,
    privacyRulesRevision,
    secondaryReady,
  );
  const photoStacks = useMemo(() => {
    const stacks = new Map<string, EaglePhotoStack>();
    for (const page of assetsQuery.data?.pages ?? [])
      for (const stack of page.photoStacks ?? []) stacks.set(stack.id, stack);
    return [...stacks.values()];
  }, [assetsQuery.data]);
  const assets = useMemo(
    () =>
      libraryMode === 'PHOTO' && photoView === 'timeline' && libraryView !== 'TRASH'
        ? collapseLivePhotoComponents(collapsePhotoStacks(loadedAssets, photoStacks), loadedAssets)
        : collapseLivePhotoComponents(loadedAssets),
    [loadedAssets, photoStacks, libraryMode, photoView, libraryView],
  );
  const previewStack = photoStacks.find((stack) => stack.assetIds.includes(previewAssetId ?? ''));
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
    setSelectedAssetIds((current) => {
      const next = current.filter((id) => assetsById.has(id));
      return next.length === current.length ? current : next;
    });
    if (selectedAssetId && !assetsById.has(selectedAssetId)) setSelectedAssetId(null);
  }, [
    isAssetView,
    showsAssetControls,
    assetsQuery.isFetched,
    assetsQuery.isFetching,
    assetsQuery.isPlaceholderData,
    assetsById,
    selectedAssetId,
  ]);
  const selectedTransferAssets = selectedAssetIds.flatMap((id) => {
    const asset = assetsById.get(id);
    return asset ? [asset] : [];
  });
  const contextMenuAsset =
    selectedAssetIds.length === 1 ? (assetsById.get(selectedAssetIds[0]) ?? null) : null;
  const imageClipboardAvailable = canCopyImageToClipboard();
  const selectedAssetQuery = useQuery({
    queryKey: queryKeys.assetDetail(selectedAssetId, libraryView),
    queryFn: ({ signal }) =>
      libraryView === 'TRASH'
        ? getEagleTrashAsset(accessToken, selectedAssetId!, signal)
        : getEagleAsset(accessToken, selectedAssetId!, signal),
    enabled: selectedAssetId !== null && isInspectorVisible,
  });
  const selectedAsset: EagleAsset | null = selectedAssetQuery.data ?? null;
  const isSelectedAssetReadOnly = libraryView === 'TRASH';
  const selectedAssetVersions: EagleAssetVersion[] = selectedAssetIds.flatMap((assetId) => {
    const listVersion = assetsById.get(assetId)?.rowVersion;
    const detailVersion = assetId === selectedAsset?.id ? selectedAsset.rowVersion : undefined;
    const versions = [listVersion, detailVersion].filter(
      (version): version is number => version !== undefined,
    );
    return versions.length ? [{ assetId, rowVersion: Math.max(...versions) }] : [];
  });
  const selectedRating = selectedAssetIds.every(
    (assetId) => assetsById.get(assetId)?.rating === assetsById.get(selectedAssetIds[0])?.rating,
  )
    ? assetsById.get(selectedAssetIds[0])?.rating
    : undefined;
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
  const timelineSectionKeys = useMemo(
    () =>
      isPhotoTimeline &&
      !deferredSearch &&
      !(activeSmartFolderId && smartFolderOrder === 'RELEVANCE')
        ? compact
          ? createPhotoTimelineDayKeys(assets)
          : createPhotoTimelineSectionKeys(assets)
        : undefined,
    [assets, isPhotoTimeline, deferredSearch, compact, activeSmartFolderId, smartFolderOrder],
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
    accessToken,
    assets: observedAssets,
    enabled: isAssetView,
    assetStore,
    updatesQueryKey: queryKeys.assetUpdates,
  });
  const colorCoverage = assetsQuery.data?.pages[0]?.colorCoverage ?? null;
  const manualTagGroups = manualTagGroupsQuery.data ?? [];
  const aiTags = aiTagsQuery.data ?? [];
  const smartFolders = smartFoldersQuery.data ?? [];
  const previewScopeValid = !previewContext || previewContext.scope === editingScope;
  const previewAssets = previewContext ? (previewScopeValid ? previewContext.items : []) : assets;
  const previewAsset = previewAssets.find((asset) => asset.id === previewAssetId) ?? null;
  const previewImageAsset = imagePreview.previewImage?.assetId
    ? (previewAssets.find((asset) => asset.id === imagePreview.previewImage?.assetId) ?? null)
    : null;
  const previewCanHavePyramid = Boolean(
    previewImageAsset && needsEagleImagePyramid(previewImageAsset.width, previewImageAsset.height),
  );
  const previewPyramidQuery = useQuery({
    queryKey: [...queryKeys.root, 'pyramid', imagePreview.previewImage?.assetId ?? 'none'],
    queryFn: ({ signal }) =>
      getEaglePyramidDescriptor(accessToken, imagePreview.previewImage!.assetId!, signal),
    enabled: Boolean(imagePreview.previewImage?.assetId && previewCanHavePyramid),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
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
    const isNewAsset = editorAssetIdRef.current !== selectedAsset.id;
    if (isNewAsset) {
      metadataMutation.reset();
      editorAssetIdRef.current = selectedAsset.id;
      editorDirtyRef.current = false;
      editorDirtyFieldsRef.current.clear();
      editorRevisionRef.current = 0;
    } else if (editorDirtyRef.current) {
      return;
    }
    setEditorTitle(selectedAsset.displayName);
    setEditorDescription(selectedAsset.annotation?.description ?? '');
    setEditorSourceUrl(selectedAsset.annotation?.sourceUrl ?? '');
  }, [
    isInspectorVisible,
    selectedAsset?.id,
    selectedAsset?.updatedAt,
    selectedAssetQuery.dataUpdatedAt,
  ]);
  const saveEditedMetadata = () => {
    if (
      !selectedAsset ||
      isSelectedAssetReadOnly ||
      !editorDirtyRef.current ||
      !editorTitle.trim() ||
      metadataFormRef.current?.checkValidity() === false
    ) {
      return;
    }
    const input: Pick<EagleAssetChanges, 'displayName' | 'description' | 'sourceUrl'> = {};
    if (editorDirtyFieldsRef.current.has('displayName')) input.displayName = editorTitle;
    if (editorDirtyFieldsRef.current.has('description')) {
      input.description = editorDescription.trim() || null;
    }
    if (editorDirtyFieldsRef.current.has('sourceUrl')) {
      input.sourceUrl = editorSourceUrl.trim() || null;
    }
    metadataMutation.mutate({
      assetId: selectedAsset.id,
      assets: selectedAssetVersions,
      revision: editorRevisionRef.current,
      input,
    });
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
  const changeLibraryView = (view: EagleLibraryView) => {
    assetLocator.clearLocation();
    setTimelineCursor('');
    setPhotoView('timeline');
    setLibraryView(view);
    if (
      view === 'PRIVATE' ||
      view === 'TRASH' ||
      libraryView === 'PRIVATE' ||
      libraryView === 'TRASH'
    ) {
      setActiveSmartFolderId(null);
      resetFilters();
    }
    setSelectedAssetIds([]);
    setSelectedAssetId(null);
    setIsBatchSelection(false);
    setSelectionMode(false);
    setAssetContextMenu(null);
    selectionAnchorIdRef.current = null;
  };
  const openLibraryRoot = (view: EaglePhotoView = 'timeline') => {
    changeLibraryView('ACTIVE');
    setActiveSmartFolderId(null);
    setPhotoView(view);
  };
  const applySmartFolder = (folder: EagleSmartFolder) => {
    setPhotoView('timeline');
    setLibraryView('ACTIVE');
    setSmartFolderOrder(
      folder.semanticState || readEagleSemanticIntent(toEagleFilterQuery(folder.queryJson))
        ? 'RELEVANCE'
        : 'DATE',
    );
    setActiveSmartFolderId(folder.id);
    resetFilters();
    setSelectedAssetId(null);
    setSelectedAssetIds([]);
    setIsBatchSelection(false);
    setSelectionMode(false);
    setAssetContextMenu(null);
    selectionAnchorIdRef.current = null;
  };
  const selectAsset = (assetId: string, gesture: EagleSelectionGesture) => {
    const nextSelection = applyEagleSelection({
      orderedIds: assets.map((asset) => asset.id),
      selectedIds: selectedAssetIds,
      activeId: selectedAssetId,
      anchorId: selectionAnchorIdRef.current,
      clickedId: assetId,
      gesture,
    });
    setSelectedAssetIds(nextSelection.selectedIds);
    setSelectedAssetId(nextSelection.activeId);
    setIsBatchSelection(nextSelection.isBatchSelection);
    selectionAnchorIdRef.current = nextSelection.anchorId;
  };
  const clearAssetSelection = useCallback(() => {
    setSelectedAssetIds([]);
    setSelectedAssetId(null);
    setIsBatchSelection(false);
    setSelectionMode(false);
    setAssetContextMenu(null);
    selectionAnchorIdRef.current = null;
  }, []);
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
  const desktopAssetDragBridge = libraryMode === 'PHOTO' ? null : getDesktopAssetDragBridge();
  const assetDragSession = useMemo(
    () =>
      desktopAssetDragBridge
        ? new DesktopAssetDragSession(
            desktopAssetDragBridge,
            (error) => {
              setAssetDragStatus(null);
              setOriginalFileError(error instanceof Error ? error.message : t('原文件拖出失败。'));
            },
            setAssetDragStatus,
          )
        : null,
    [desktopAssetDragBridge, ownerId],
  );
  useEffect(
    () => () => {
      assetDragSession?.reset();
    },
    [assetDragSession],
  );
  useEffect(() => {
    if (!assetDragSession) return undefined;
    const endPendingGesture = () => {
      if (!assetDragSession.hasNativeDragStarted()) assetDragSession.end('cancelled');
    };
    window.addEventListener('pointerup', endPendingGesture, true);
    window.addEventListener('pointercancel', endPendingGesture, true);
    return () => {
      window.removeEventListener('pointerup', endPendingGesture, true);
      window.removeEventListener('pointercancel', endPendingGesture, true);
    };
  }, [assetDragSession]);
  const getDragAssetIds = (assetId: string) =>
    getAssetDragIds({
      orderedIds: assets.map((asset) => asset.id),
      selectedIds: selectedAssetIds,
      draggedId: assetId,
    });
  const queueOriginalDownloads = async (selected: EagleAssetListItem[]) => {
    const epoch = workspaceCache.downloads.epoch;
    const originals = new Map(selected.map((asset) => [asset.id, asset]));
    for (const asset of selected) {
      const id = asset.livePhotoMotion?.assetId;
      if (id && !originals.has(id)) originals.set(id, await getEagleAsset(accessToken, id));
    }
    if (epoch !== workspaceCache.downloads.epoch)
      throw new DOMException('Scope revoked', 'AbortError');
    return downloadOriginalFiles([...originals.values()], {
      queueBrowserDownloads: (items) => workspaceCache.downloads.enqueue(items),
    });
  };
  const saveSelectedOriginal = () => {
    if (!contextMenuAsset || assetActionPending) return;
    setAssetActionPending('save');
    setAssetActionError(null);
    const download = contextMenuAsset.livePhotoMotion
      ? queueOriginalDownloads([contextMenuAsset])
      : saveOriginalFile(contextMenuAsset);
    void download.then(
      () => {
        setAssetActionPending(null);
        setAssetContextMenu(null);
      },
      () => {
        setAssetActionPending(null);
        setAssetActionError(
          t('另存原文件失败{{value1}}', {
            value1: t('，请重试。'),
          }),
        );
      },
    );
  };
  const copySelectedImage = () => {
    const previewUrl = contextMenuAsset ? getEaglePreviewContentUrl(contextMenuAsset) : null;
    if (!contextMenuAsset?.mimeType.startsWith('image/') || !previewUrl || assetActionPending) {
      return;
    }
    setAssetActionPending('copy');
    setAssetActionError(null);
    void copyImageToClipboard(previewUrl).then(
      () => {
        setAssetActionPending(null);
        setAssetContextMenu(null);
      },
      (error: unknown) => {
        setAssetActionPending(null);
        const detail = error instanceof Error ? `：${error.message}` : t('，请重试。');
        setAssetActionError(
          t('复制图片失败{{value1}}', {
            value1: detail,
          }),
        );
      },
    );
  };
  const handleAssetDragStart = (event: DragEvent<HTMLButtonElement>, assetId: string) => {
    event.preventDefault();
    if (!assetDragSession || libraryView === 'TRASH') return;
    const assetIds = getDragAssetIds(assetId);
    if (!selectedAssetIds.includes(assetId)) selectAsset(assetId, 'single');
    setAssetContextMenu(null);
    setOriginalFileError(null);
    assetDragSession.begin(assetIds);
  };
  const batchDownloadSelectedOriginals = () => {
    if (isBatchDownloading) return;
    const selected = new Set(selectedAssetIds);
    const selectedAssets = assets.filter((asset) => selected.has(asset.id));
    if (selectedAssets.length < 2) return;
    setIsBatchDownloading(true);
    setOriginalFileError(null);
    void queueOriginalDownloads(selectedAssets).then(
      () => {
        setAssetContextMenu(null);
        setIsBatchDownloading(false);
      },
      () => {
        setAssetContextMenu(null);
        setIsBatchDownloading(false);
        setOriginalFileError(t('批量下载原文件失败。'));
      },
    );
  };
  const locationId = assetLocator.location?.assetId;
  const locationCoverId =
    photoStacks.find((stack) => locationId && stack.assetIds.includes(locationId))?.cover.id ??
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
    setPreviewContext(items.length ? { scope: editingScope, items } : null);
    if (photoStacks.some((stack) => stack.assetIds.includes(asset.id))) {
      setPreviewAssetId(asset.id);
      return;
    }
    if (isCameraVideoMime(asset.mimeType)) {
      setPreviewAssetId(asset.id);
      return;
    }
    const src = getEaglePreviewContentUrl(asset);
    if (src) {
      preloadEagleImageViewer();
      imagePreview.setPreviewImage({
        src,
        alt: asset.displayName,
        assetId: asset.id,
        motionSrc: getEagleLivePhotoContentUrl(asset),
      });
    }
  };
  useEffect(() => {
    setPreviewContext(null);
    setPreviewAssetId(null);
    imagePreview.closePreview();
  }, [editingScope, imagePreview.closePreview]);
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
  const showAssetsForTag = (kind: 'MANUAL' | 'AI', tagId: string) => {
    changeLibraryView('ACTIVE');
    setQuickFilters({
      ...createEmptyEagleQuickFilterState(),
      ...(kind === 'MANUAL' ? { manualTagIds: [tagId] } : { aiTagIds: [tagId] }),
    });
  };
  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (libraryView === 'PROCESSING' || libraryView === 'ACCOUNT') return;
    if (assetDragSession?.isOutboundDrag()) return;
    if (!isFileDrag(event)) return;
    event.preventDefault();
    importDragActiveRef.current = true;
    dragDepthRef.current += 1;
    setIsDragging(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!importDragActiveRef.current) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      importDragActiveRef.current = false;
      setIsDragging(false);
    }
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (libraryView === 'PROCESSING' || libraryView === 'ACCOUNT') return;
    if (assetDragSession?.isOutboundDrag()) {
      event.preventDefault();
      assetDragSession.end();
      importDragActiveRef.current = false;
      dragDepthRef.current = 0;
      setIsDragging(false);
      return;
    }
    if (!isFileDrag(event) && event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    importDragActiveRef.current = false;
    dragDepthRef.current = 0;
    setIsDragging(false);
    void importFiles([...event.dataTransfer.files]);
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
          aiTags={aiTags}
          onRequestAiTags={() => setAiTagReferenceRequested(true)}
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
          busy={updateSmartFolderMutation.isPending || moveSmartFolderMutation.isPending}
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
      changeLibraryView('ACTIVE');
      setPhotoView(destination);
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
          aria-label={t('恢复当前素材')}
          disabled={!selectedAssetId || restoreMutation.isPending}
          onClick={() => {
            if (selectedAssetId) restoreMutation.mutate([selectedAssetId]);
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
            if (window.confirm(t('确认清空回收站？其中的全部素材将被永久删除，且无法恢复。'))) {
              emptyTrashMutation.mutate();
            }
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
                changeLibraryView('ACTIVE');
                setPhotoView('timeline');
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
              items={[
                { view: 'MANUAL_TAGS', label: t('人工标签') },
                { view: 'AI_TAGS', label: t('AI 标签') },
              ]}
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
                  changeLibraryView('ACTIVE');
                  setPhotoView('agent');
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
                onAssetRelationsChanged={(ids) =>
                  refreshEagleAssetRelations(queryClient, queryKeys, ids)
                }
              />
            </AsyncViewBoundary>
          ) : libraryView === 'MANUAL_TAGS' || libraryView === 'AI_TAGS' ? (
            <EagleTagPage
              kind={libraryView === 'MANUAL_TAGS' ? 'MANUAL' : 'AI'}
              manualTags={manualTags}
              aiTags={aiTags}
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
                  (libraryView === 'MANUAL_TAGS'
                    ? (manualTagsQuery.error ?? manualTagGroupsQuery.error)
                    : aiTagsQuery.error)
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
              onSelectTag={(tagId) =>
                showAssetsForTag(libraryView === 'MANUAL_TAGS' ? 'MANUAL' : 'AI', tagId)
              }
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
              {backgroundChanges && (
                <div className={styles.statusBar} role="status">
                  {t('后台内容已更新，当前浏览位置保持不变。')}
                  <button
                    type="button"
                    disabled={assetsQuery.isFetching}
                    onClick={() => {
                      const revision = workspaceCache.backgroundRevision;
                      void assetsQuery
                        .refetch({ cancelRefetch: false, throwOnError: true })
                        .then(() => workspaceCache.acknowledgeBackgroundChanges(revision))
                        .catch(() => undefined);
                    }}
                  >
                    {t('加载更新')}
                  </button>
                </div>
              )}
              {transferStatus && (
                <div className={styles.statusBar} role="status">
                  {transferStatus}
                  <button type="button" onClick={() => changeLibraryView('PROCESSING')}>
                    {t('查看进度')}
                  </button>
                </div>
              )}
              {selectionToolbar}
              <EagleUploadQueue
                items={uploads}
                status={uploadStatus}
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
                <div className={styles.errorBar} role="alert">
                  {originalFileError}
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
                moveSmartFolderMutation.isError) && (
                <div className={styles.errorBar} role="alert">
                  {
                    (
                      trashMutation.error ??
                      restoreMutation.error ??
                      emptyTrashMutation.error ??
                      updateSmartFolderMutation.error ??
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
                  onClick={clearAssetSelection}
                  onScroll={(event) => assetViewport.handleScroll(event.currentTarget.scrollTop)}
                >
                  {(filterInputsPending ||
                    (assetsQuery.isFetching && !assetsQuery.isFetchingNextPage)) &&
                    !assetsQuery.isLoading && (
                      <div className={styles.queryProgress} role="status">
                        {t('正在更新结果…')}
                      </div>
                    )}
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
                        const isSelected = selectedAssetIds.includes(asset.id);
                        const stack = photoStacks.find((entry) => entry.cover.id === asset.id);
                        return (
                          <button
                            key={asset.id}
                            disabled={filterInputsPending || assetsQuery.isPlaceholderData}
                            data-asset-id={asset.id}
                            type="button"
                            className={`${styles.assetCard} ${isSelected ? styles.assetCardSelected : ''}`}
                            aria-pressed={isSelected}
                            aria-label={`${asset.displayName}，${asset.format.toUpperCase()}${stack ? `，${t('照片组，共 {{value1}} 张', { value1: stack.assetIds.length })}` : ''}`}
                            draggable={Boolean(desktopAssetDragBridge) && libraryView !== 'TRASH'}
                            style={
                              masonryItem
                                ? {
                                    height: masonryItem.height,
                                    transform: `translate3d(${masonryItem.left}px, ${masonryItem.top}px, 0)`,
                                    width: masonryItem.width,
                                  }
                                : undefined
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              handleAssetClick(event, asset.id);
                            }}
                            onContextMenu={(event) => handleAssetContextMenu(event, asset.id)}
                            onDragStart={(event) => handleAssetDragStart(event, asset.id)}
                            onDragEnd={() => {
                              assetDragSession?.end();
                              dragDepthRef.current = 0;
                              setIsDragging(false);
                            }}
                            onDoubleClick={() => {
                              if (!selectionMode) openAssetPreview(asset);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                if (selectionMode) selectAsset(asset.id, 'toggle');
                                else {
                                  selectAsset(asset.id, 'single');
                                  openAssetPreview(asset);
                                }
                              }
                            }}
                          >
                            <span
                              className={styles.preview}
                              style={{ height: masonryItem.previewHeight }}
                            >
                              {getEagleLivePhotoContentUrl(asset) && (
                                <span className={styles.livePhotoBadge}>{t('实况')}</span>
                              )}
                              <EagleStackBadge count={stack?.assetIds.length ?? 0} />
                              {(selectionMode || isBatchSelection) && (
                                <span className={styles.selectionMark}>
                                  {isSelected && <IconCheck size={13} />}
                                </span>
                              )}
                              <EagleAssetThumbnail
                                asset={asset}
                                scheduler={thumbnailScheduler}
                                loadService={thumbnailLoadService}
                                order={-masonryItem.top}
                                displayWidth={Math.ceil(masonryItem.width)}
                              />
                              {asset.lifecycleStatus !== 'READY' && (
                                <span className={styles.processing}>
                                  {asset.lifecycleStatus === 'FAILED' ? t('处理失败') : t('处理中')}
                                </span>
                              )}
                              {asset.isPrivate && (
                                <span
                                  className={styles.privateMark}
                                  title={libraryMode === 'PHOTO' ? t('隐私照片') : t('隐私素材')}
                                >
                                  <IconLock size={12} />
                                </span>
                              )}
                            </span>
                          </button>
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
                          value={editorTitle}
                          onChange={(event) => {
                            editorDirtyRef.current = true;
                            editorDirtyFieldsRef.current.add('displayName');
                            editorRevisionRef.current += 1;
                            setEditorTitle(event.target.value);
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
                  <section className={styles.detailSection}>
                    <h3>
                      <IconSparkles size={15} />
                      {' ' + t('AI 自动标签') + ' '}
                    </h3>
                    <div className={styles.tagList}>
                      {selectedAsset.aiTags.length ? (
                        selectedAsset.aiTags.map((tag) => <span key={tag.id}>{tag.name}</span>)
                      ) : (
                        <em>{t('AI 分析尚未启用')}</em>
                      )}
                    </div>
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
                        value={editorDescription}
                        onChange={(event) => {
                          editorDirtyRef.current = true;
                          editorDirtyFieldsRef.current.add('description');
                          editorRevisionRef.current += 1;
                          setEditorDescription(event.target.value);
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
                        value={editorSourceUrl}
                        onChange={(event) => {
                          editorDirtyRef.current = true;
                          editorDirtyFieldsRef.current.add('sourceUrl');
                          editorRevisionRef.current += 1;
                          setEditorSourceUrl(event.target.value);
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
                  {metadataMutation.isSuccess && !editorDirtyRef.current && (
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
                        </button>
                      ))}
                    </div>
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
                key={`${storeScope}:${[...selectedAssetIds].sort().join(',')}`}
                assetIds={selectedAssetIds}
                label={libraryMode === 'PHOTO' ? t('发送到素材') : t('发送到照片')}
                disabled={selectedTransferAssets.some((asset) => asset.lifecycleStatus !== 'READY')}
                onQueued={() => {
                  setAssetContextMenu(null);
                  setSelectedAssetIds([]);
                  setSelectedAssetId(null);
                  setIsBatchSelection(false);
                  setSelectionMode(false);
                  setTransferStatus(t('已加入任务中心，可继续浏览。'));
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
              {assetActionPending === 'copy' ? t('正在复制…') : t('复制图片')}
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
          onClose={() => setPreviewAssetId(null)}
        />
      ) : (
        previewAsset && (
          <EagleAssetLightbox
            asset={previewAsset}
            onEdit={libraryView === 'TRASH' ? undefined : openPhotoEditor}
            onLocate={libraryView === 'TRASH' ? undefined : assetLocator.locate}
            onClose={() => setPreviewAssetId(null)}
          />
        )
      )}
      {imagePreview.previewImage && previewScopeValid ? (
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
          accessToken={accessToken}
          initialQuery={
            editingSmartFolder
              ? toEagleFilterQuery(editingSmartFolder.queryJson)
              : buildEagleQuickFilterQuery(quickFilters)
          }
          initialName={editingSmartFolder?.name}
          mode={editingSmartFolder ? 'edit' : 'create'}
          manualTags={manualTags}
          aiTags={aiTags}
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
