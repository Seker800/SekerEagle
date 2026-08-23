import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { toEagleFilterQuery } from '@sekereagle/eagle-filter-core';
import {
  IconCheck,
  IconLayoutGrid,
  IconLayoutSidebarRight,
  IconLock,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconTags,
  IconTrash,
  IconUserCircle,
  IconX,
} from '@tabler/icons-react';
import sekerEagleLogo from '../../assets/seker-eagle-logo.svg';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useImagePreviewState } from '../media/image-preview/useImagePreviewState';
import {
  getEagleAsset,
  getEagleTrashAsset,
  getEaglePyramidDescriptor,
  listEagleAssets,
  listEagleTrash,
  type EagleAsset,
  type EagleAssetListItem,
  type EagleAssetFilters,
  type EagleAssetChanges,
  type EagleAssetVersion,
  type EagleSmartFolder,
} from '../../lib/eagle-api';
import type { PrivacyVisibilityState } from '../../lib/privacy-visibility-api';
import { fetchEagleVectorSummary } from '../../lib/eagle-vector-api';
import { EagleAssetLightbox } from './EagleAssetLightbox';
import { EagleImageViewer, preloadEagleImageViewer } from './EagleImageViewer';
import { useEagleAssetViewport } from './eagle-asset-viewport';
import { EagleAssetThumbnail } from './EagleAssetThumbnail';
import { getEaglePreviewContentUrl, needsEagleImagePyramid } from './eagle-media-sources';
import { EagleBatchTagPicker } from './EagleBatchTagPicker';
import { EagleColorPalette } from './EagleColorPalette';
import { EagleProcessingPage } from './EagleProcessingPage';
import { EagleVectorWorkspace, type EagleVectorWorkspaceView } from './EagleVectorWorkspace';
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
import { getEagleAssetEntityStore } from './eagle-asset-entity-store';
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

interface SekerEaglePageProps {
  accessToken?: string;
  ownerId: string;
  canManageProcessing?: boolean;
  accountView?: ReactNode;
  privacyVisibility?: PrivacyVisibilityState;
}

type EagleAssetContextMenu = { x: number; y: number };
type EagleLibraryView =
  | 'ACTIVE'
  | 'PRIVATE'
  | 'TRASH'
  | 'MANUAL_TAGS'
  | 'AI_TAGS'
  | 'VECTOR_REVIEW'
  | 'VECTOR_TAGS'
  | 'VECTOR_UNCLASSIFIED'
  | 'PROCESSING'
  | 'ACCOUNT';
const VECTOR_LIBRARY_VIEWS: Record<EagleVectorWorkspaceView, EagleLibraryView> = {
  REVIEW: 'VECTOR_REVIEW',
  TAGS: 'VECTOR_TAGS',
  UNCLASSIFIED: 'VECTOR_UNCLASSIFIED',
};

function getVectorWorkspaceView(view: EagleLibraryView): EagleVectorWorkspaceView | null {
  if (view === 'VECTOR_REVIEW') return 'REVIEW';
  if (view === 'VECTOR_TAGS') return 'TAGS';
  if (view === 'VECTOR_UNCLASSIFIED') return 'UNCLASSIFIED';
  return null;
}
const EAGLE_PAGE_SIZE = 40;
const EAGLE_PREFERENCES_KEY = 'seker-eagle.preferences.v1';
const DEFAULT_THUMBNAIL_SIZE = 210;
function readThumbnailSize(): number {
  try {
    const preferences: unknown = JSON.parse(
      window.localStorage.getItem(EAGLE_PREFERENCES_KEY) ?? '{}',
    );
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

export function SekerEaglePage({
  accessToken: providedAccessToken,
  ownerId,
  canManageProcessing = false,
  accountView,
  privacyVisibility,
}: SekerEaglePageProps) {
  const accessToken = providedAccessToken ?? '';
  const queryClient = useQueryClient();
  const privateVisible = privacyVisibility?.enabled === true;
  const queryKeys = useMemo(() => {
    if (!ownerId) throw new Error('SekerEagle requires an authenticated owner identity.');
    return createEagleQueryKeys(ownerId);
  }, [ownerId]);
  const thumbnailScheduler = useMemo(() => new MediaLoadScheduler(), [ownerId]);
  const assetViewport = useEagleAssetViewport();
  const assetViewportRef = assetViewport.elementRef;
  const pageSentinelRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const editorAssetIdRef = useRef<string | null>(null);
  const editorDirtyRef = useRef(false);
  const editorDirtyFieldsRef = useRef<Set<keyof EagleAssetChanges>>(new Set());
  const editorRevisionRef = useRef(0);
  const privacyStateRef = useRef(
    `${privacyVisibility?.enabled === true}:${privacyVisibility?.expiresAt ?? ''}`,
  );
  const metadataFormRef = useRef<HTMLFormElement>(null);
  const [search, setSearch] = useState('');
  const [libraryView, setLibraryView] = useState<EagleLibraryView>('ACTIVE');
  const [activeSmartFolderId, setActiveSmartFolderId] = useState<string | null>(null);
  const [isSmartFolderDialogOpen, setIsSmartFolderDialogOpen] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<EagleSmartFolder | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [isBatchSelection, setIsBatchSelection] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assetContextMenu, setAssetContextMenu] = useState<EagleAssetContextMenu | null>(null);
  const [tagPickerAssetIds, setTagPickerAssetIds] = useState<string[] | null>(null);
  const deferredSearch = useDebouncedValue(search.normalize('NFKC').trim(), 250);
  const [quickFilters, setQuickFilters] = useState(createEmptyEagleQuickFilterState);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isInspectorVisible, setIsInspectorVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { scrollTop, viewportHeight } = assetViewport;
  const [thumbnailSize, setThumbnailSize] = useState(readThumbnailSize);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorSourceUrl, setEditorSourceUrl] = useState('');
  const imagePreview = useImagePreviewState();
  const { importFiles, uploadStatus } = useEagleUploadController(accessToken, queryKeys.assets);

  useEffect(() => {
    window.localStorage.setItem(EAGLE_PREFERENCES_KEY, JSON.stringify({ thumbnailSize }));
  }, [thumbnailSize]);

  const { manualTagsQuery, manualTagGroupsQuery, aiTagsQuery, smartFoldersQuery } =
    useEagleReferenceData(accessToken, queryKeys);
  const vectorSummaryQuery = useQuery({
    queryKey: ['eagle', ownerId, 'vector-summary'],
    queryFn: fetchEagleVectorSummary,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const vectorSummary = vectorSummaryQuery.data;
  const unavailableSuggestionCount = Math.max(
    0,
    (vectorSummary?.suggestions.unclassified ?? 0) - (vectorSummary?.suggestions.pending ?? 0),
  );
  const isAssetView =
    libraryView === 'ACTIVE' || libraryView === 'PRIVATE' || libraryView === 'TRASH';
  const activeFilterCount = countActiveEagleQuickFilters(quickFilters);
  const filterQuery = useMemo(() => buildEagleQuickFilterQuery(quickFilters), [quickFilters]);
  const assetFilters: EagleAssetFilters = {
    limit: EAGLE_PAGE_SIZE,
    search: deferredSearch || undefined,
    rules: activeFilterCount ? filterQuery : undefined,
    smartFolderId: activeSmartFolderId ?? undefined,
    privacy: libraryView === 'PRIVATE' ? 'PRIVATE' : undefined,
  };
  const assetStore = useMemo(() => getEagleAssetEntityStore(ownerId), [ownerId]);
  const assetStoreRevision = useSyncExternalStore(
    assetStore.subscribe,
    assetStore.getSnapshot,
    assetStore.getSnapshot,
  );
  const assetsQuery = useInfiniteQuery({
    queryKey: queryKeys.assetList(libraryView, assetFilters),
    queryFn: async ({ pageParam, signal }) => {
      const pageFilters = { ...assetFilters, cursor: pageParam || undefined };
      const page =
        libraryView === 'TRASH'
          ? await listEagleTrash(accessToken, pageFilters, signal)
          : await listEagleAssets(accessToken, pageFilters, signal);
      return assetStore.normalizePage(page);
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isAssetView,
    gcTime: 60_000,
  });
  const {
    ratingMutation,
    metadataMutation,
    createTagMutation,
    createBatchTagMutation,
    createTagGroupMutation,
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
    privacyMutation,
  } = useEagleMutations(accessToken, queryKeys, {
    onMetadataSaved: (assetId, revision) => {
      if (editorAssetIdRef.current === assetId && editorRevisionRef.current === revision) {
        editorDirtyRef.current = false;
        editorDirtyFieldsRef.current.clear();
      }
    },
    onBatchTagsApplied: () => setTagPickerAssetIds(null),
    onSelectionMutationCompleted: () => {
      setSelectedAssetIds([]);
      setSelectedAssetId(null);
      setIsBatchSelection(false);
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

  const assets = useMemo(() => {
    const uniqueAssets = new Map<string, EagleAssetListItem>();
    assetsQuery.data?.pages.forEach((page) => {
      assetStore.getMany(page.assetIds).forEach((item) => uniqueAssets.set(item.id, item));
    });
    return [...uniqueAssets.values()];
  }, [assetStore, assetStoreRevision, assetsQuery.data]);

  useEffect(() => {
    const nextPrivacyState = `${privateVisible}:${privacyVisibility?.expiresAt ?? ''}`;
    if (privacyStateRef.current === nextPrivacyState) return;
    privacyStateRef.current = nextPrivacyState;
    assetStore.clear();
    setPreviewAssetId(null);
    imagePreview.closePreview();
    setSelectedAssetIds([]);
    setSelectedAssetId(null);
    setIsBatchSelection(false);
    setAssetContextMenu(null);
    if (!privateVisible && libraryView === 'PRIVATE') setLibraryView('ACTIVE');
    void queryClient.resetQueries({ queryKey: queryKeys.root });
  }, [
    assetStore,
    imagePreview,
    libraryView,
    privateVisible,
    privacyVisibility?.expiresAt,
    queryClient,
    queryKeys.root,
  ]);
  const assetsById = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);
  const selectedAssetQuery = useQuery({
    queryKey: [...queryKeys.assetDetail(selectedAssetId), libraryView],
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
  const selectedManualTags = useMemo(() => {
    const tagsById = new Map<string, EagleAsset['manualTags'][number]>();
    for (const assetId of selectedAssetIds) {
      const tags =
        assetId === selectedAsset?.id
          ? selectedAsset.manualTags
          : (assetsById.get(assetId)?.manualTags ?? []);
      tags.forEach((tag) => tagsById.set(tag.id, tag));
    }
    return [...tagsById.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [assetsById, selectedAsset, selectedAssetIds]);
  const { containerRef: masonryRef, layout: masonryLayout } = useEagleMasonryLayout(assets, {
    targetCardWidth: thumbnailSize,
  });
  const masonryViewportIndex = useMemo(
    () => buildMasonryViewportIndex(masonryLayout.items),
    [masonryLayout.items],
  );
  const visibleMasonryItems = useMemo(
    () =>
      selectVisibleMasonryItemsFromIndex(masonryViewportIndex, {
        scrollTop,
        viewportHeight,
        overscan: Math.max(1_200, viewportHeight * 2),
      }),
    [masonryViewportIndex, scrollTop, viewportHeight],
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
  useEagleProcessingUpdates({
    accessToken,
    assets: observedAssets,
    enabled: isAssetView,
    assetStore,
    updatesQueryKey: queryKeys.assetUpdates,
  });
  const colorCoverage = assetsQuery.data?.pages[0]?.colorCoverage ?? null;
  const manualTags = manualTagsQuery.data ?? [];
  const manualTagGroups = manualTagGroupsQuery.data ?? [];
  const aiTags = aiTagsQuery.data ?? [];
  const smartFolders = smartFoldersQuery.data ?? [];
  const previewAsset = assets.find((asset) => asset.id === previewAssetId) ?? null;
  const previewImageAsset = imagePreview.previewImage?.assetId
    ? (assetsById.get(imagePreview.previewImage.assetId) ?? null)
    : null;
  const previewCanHavePyramid = Boolean(
    previewImageAsset && needsEagleImagePyramid(previewImageAsset.width, previewImageAsset.height),
  );
  const previewPyramidQuery = useQuery({
    queryKey: ['eagle', ownerId, 'pyramid', imagePreview.previewImage?.assetId ?? 'none'],
    queryFn: ({ signal }) =>
      getEaglePyramidDescriptor(accessToken, imagePreview.previewImage!.assetId!, signal),
    enabled: Boolean(imagePreview.previewImage?.assetId && previewCanHavePyramid),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const isInspectorOpen = isAssetView && isInspectorVisible;
  const activeSmartFolder =
    smartFolders.find((folder) => folder.id === activeSmartFolderId) ?? null;
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
        if (entry.isIntersecting && assetsQuery.hasNextPage && !assetsQuery.isFetchingNextPage) {
          void assetsQuery.fetchNextPage();
        }
      },
      { root: assetViewportRef.current, rootMargin: '600px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [assetsQuery.fetchNextPage, assetsQuery.hasNextPage, assetsQuery.isFetchingNextPage]);

  const resetFilters = () => {
    setQuickFilters(createEmptyEagleQuickFilterState());
  };

  const changeLibraryView = (view: EagleLibraryView) => {
    setLibraryView(view);
    setActiveSmartFolderId(null);
    setSelectedAssetIds([]);
    setSelectedAssetId(null);
    setIsBatchSelection(false);
    setAssetContextMenu(null);
    selectionAnchorIdRef.current = null;
    resetFilters();
  };

  const applySmartFolder = (folder: EagleSmartFolder) => {
    setLibraryView('ACTIVE');
    setActiveSmartFolderId(folder.id);
    resetFilters();
    setSelectedAssetId(null);
    setSelectedAssetIds([]);
    setIsBatchSelection(false);
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
    setAssetContextMenu(null);
    selectionAnchorIdRef.current = null;
  }, []);

  useEffect(() => {
    if (tagPickerAssetIds) return undefined;
    if (!isBatchSelection && !assetContextMenu) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (assetContextMenu) setAssetContextMenu(null);
      else clearAssetSelection();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assetContextMenu, clearAssetSelection, isBatchSelection, tagPickerAssetIds]);

  const handleAssetClick = (event: MouseEvent<HTMLButtonElement>, assetId: string) => {
    setAssetContextMenu(null);
    const gesture: EagleSelectionGesture = event.shiftKey
      ? 'range'
      : event.ctrlKey || event.metaKey
        ? 'toggle'
        : 'single';
    selectAsset(assetId, gesture);
  };

  const handleAssetContextMenu = (event: MouseEvent<HTMLButtonElement>, assetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedAssetIds.includes(assetId)) selectAsset(assetId, 'single');
    setAssetContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)),
    });
  };

  const openAssetPreview = (asset: EagleAssetListItem) => {
    if (asset.mimeType.startsWith('video/')) {
      setPreviewAssetId(asset.id);
      return;
    }
    const src = getEaglePreviewContentUrl(asset);
    if (src) {
      preloadEagleImageViewer();
      imagePreview.setPreviewImage({ src, alt: asset.displayName, assetId: asset.id });
    }
  };

  useEffect(() => {
    const currentPreview = imagePreview.previewImage;
    if (!currentPreview) return undefined;

    const imageAssets = assets.filter((asset) => asset.mimeType.startsWith('image/'));
    const currentIndex = imageAssets.findIndex((asset) => asset.id === currentPreview.assetId);
    if (currentIndex === -1) return undefined;

    const handlePreviewNavigation = (event: KeyboardEvent) => {
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (!direction) return;

      const nextAsset = imageAssets[currentIndex + direction];
      if (!nextAsset) return;

      event.preventDefault();
      const src = getEaglePreviewContentUrl(nextAsset);
      if (src) {
        imagePreview.setPreviewImage({ src, alt: nextAsset.displayName, assetId: nextAsset.id });
      }
    };

    window.addEventListener('keydown', handlePreviewNavigation);
    return () => window.removeEventListener('keydown', handlePreviewNavigation);
  }, [assets, imagePreview.previewImage, imagePreview.setPreviewImage]);

  const showAssetsForTag = (kind: 'MANUAL' | 'AI', tagId: string) => {
    changeLibraryView('ACTIVE');
    setQuickFilters({
      ...createEmptyEagleQuickFilterState(),
      ...(kind === 'MANUAL' ? { manualTagIds: [tagId] } : { aiTagIds: [tagId] }),
    });
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (libraryView === 'PROCESSING' || libraryView === 'ACCOUNT') return;
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (libraryView === 'PROCESSING' || libraryView === 'ACCOUNT') return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    void importFiles([...event.dataTransfer.files]);
  };

  return (
    <main
      className={styles.page}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`${styles.workspace} ${!isInspectorOpen ? styles.workspaceWide : ''}`}>
        <nav className={styles.sidebar} aria-label="素材库导航">
          <div className={styles.sidebarHeader}>
            <div className={styles.brand}>
              <span className={styles.mark} aria-hidden="true">
                <img src={sekerEagleLogo} alt="" />
              </span>
              <span>SekerEagle</span>
            </div>
          </div>
          <button
            className={
              libraryView === 'ACTIVE' && !activeSmartFolderId ? styles.navActive : undefined
            }
            type="button"
            onClick={() => changeLibraryView('ACTIVE')}
          >
            <IconPhoto size={17} />
            全部素材
            {libraryView === 'ACTIVE' && !activeSmartFolderId && <span>{assets.length}</span>}
          </button>
          {privateVisible && (
            <button
              className={libraryView === 'PRIVATE' ? styles.navActive : undefined}
              type="button"
              onClick={() => changeLibraryView('PRIVATE')}
              aria-label="隐私素材"
            >
              <IconLock size={17} />
              隐私素材
              {libraryView === 'PRIVATE' && <span>{assets.length}</span>}
            </button>
          )}
          <div className={styles.navSection}>
            <div className={styles.sectionLabel}>
              智能文件夹
              <button
                type="button"
                aria-label="新建智能文件夹"
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
              onSelect={applySmartFolder}
              onMove={(folder, input) => moveSmartFolderMutation.mutate({ folder, input })}
              onChangeColor={(folder, color) =>
                updateSmartFolderMutation.mutate({ folder, changes: { color } })
              }
              onEdit={(folder) => {
                setEditingSmartFolder(folder);
                setIsSmartFolderDialogOpen(true);
              }}
            />
            {smartFoldersQuery.isError && (
              <button
                className={styles.navError}
                type="button"
                onClick={() => void smartFoldersQuery.refetch()}
              >
                <IconRefresh size={15} />
                加载失败，重试
              </button>
            )}
            {!smartFoldersQuery.isLoading &&
              !smartFoldersQuery.isError &&
              smartFolders.length === 0 && <span className={styles.navEmpty}>尚未创建</span>}
          </div>
          <div className={styles.navSection}>
            <div className={styles.sectionLabel}>标签</div>
            <button
              type="button"
              className={libraryView === 'MANUAL_TAGS' ? styles.navActive : undefined}
              aria-label="人工标签"
              onClick={() => changeLibraryView('MANUAL_TAGS')}
            >
              <IconTags size={17} />
              人工标签<span>{manualTags.length}</span>
            </button>
            <button
              type="button"
              className={libraryView === 'AI_TAGS' ? styles.navActive : undefined}
              aria-label="AI 自动标签"
              onClick={() => changeLibraryView('AI_TAGS')}
            >
              <IconSparkles size={17} />
              AI 自动标签<span>{aiTags.length}</span>
            </button>
            <button
              type="button"
              className={`${styles.navSubItem} ${libraryView === 'VECTOR_REVIEW' ? styles.navActive : ''}`}
              aria-label={`智能标签确认 ${vectorSummary?.suggestions.pending ?? 0}`}
              onClick={() => changeLibraryView('VECTOR_REVIEW')}
            >
              智能标签确认<span>{vectorSummary?.suggestions.pending ?? 0}</span>
            </button>
            <button
              type="button"
              className={`${styles.navSubItem} ${libraryView === 'VECTOR_TAGS' ? styles.navActive : ''}`}
              aria-label={`标签推荐设置 ${vectorSummary?.tags.enabled ?? 0}`}
              onClick={() => changeLibraryView('VECTOR_TAGS')}
            >
              标签推荐设置<span>{vectorSummary?.tags.enabled ?? 0}</span>
            </button>
            <button
              type="button"
              className={`${styles.navSubItem} ${libraryView === 'VECTOR_UNCLASSIFIED' ? styles.navActive : ''}`}
              aria-label={`没有可用建议 ${unavailableSuggestionCount}`}
              onClick={() => changeLibraryView('VECTOR_UNCLASSIFIED')}
            >
              没有可用建议<span>{unavailableSuggestionCount}</span>
            </button>
          </div>
          <div className={styles.sidebarSpacer} />
          {accountView && (
            <div className={styles.accountSection}>
              <button
                className={libraryView === 'ACCOUNT' ? styles.navActive : undefined}
                type="button"
                onClick={() => changeLibraryView('ACCOUNT')}
                aria-label="个人账号"
              >
                <IconUserCircle size={17} />
                个人账号
              </button>
            </div>
          )}
          <div className={styles.navSection}>
            <div className={styles.sectionLabel}>工具</div>
            <button
              className={libraryView === 'PROCESSING' ? styles.navActive : undefined}
              type="button"
              aria-label="素材处理"
              onClick={() => changeLibraryView('PROCESSING')}
            >
              <IconSettings size={17} />
              素材处理
            </button>
          </div>
          <button
            className={libraryView === 'TRASH' ? styles.navActive : undefined}
            type="button"
            aria-label="回收站"
            onClick={() => changeLibraryView('TRASH')}
          >
            <IconTrash size={17} />
            回收站
          </button>
        </nav>

        <section
          className={styles.library}
          aria-label={
            libraryView === 'PROCESSING'
              ? '素材处理'
              : libraryView === 'ACCOUNT'
                ? '个人账号'
                : getVectorWorkspaceView(libraryView)
                  ? '智能标签'
                  : undefined
          }
          aria-labelledby={
            libraryView === 'PROCESSING' ||
            libraryView === 'ACCOUNT' ||
            getVectorWorkspaceView(libraryView)
              ? undefined
              : 'eagle-library-title'
          }
        >
          {libraryView === 'ACCOUNT' ? (
            accountView
          ) : libraryView === 'PROCESSING' ? (
            <EagleProcessingPage
              accessToken={accessToken}
              canManageProcessing={canManageProcessing}
            />
          ) : getVectorWorkspaceView(libraryView) ? (
            <EagleVectorWorkspace
              view={getVectorWorkspaceView(libraryView) ?? 'REVIEW'}
              onViewChange={(view) => changeLibraryView(VECTOR_LIBRARY_VIEWS[view])}
            />
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
              <div className={styles.toolbar}>
                <div className={styles.titleBlock}>
                  <h1 id="eagle-library-title">
                    {libraryView === 'TRASH'
                      ? '回收站'
                      : libraryView === 'PRIVATE'
                        ? '隐私素材'
                        : (activeSmartFolder?.name ?? '全部素材')}
                  </h1>
                  <span>{assets.length} 项</span>
                  {privateVisible && privacyVisibility?.expiresAt ? (
                    <span className={styles.privacyStatus}>
                      <IconLock size={12} /> 隐私内容已显示
                    </span>
                  ) : null}
                </div>
                <label className={styles.searchBox}>
                  <IconSearch size={17} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="搜索素材"
                    placeholder="搜索名称或标签"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {search && (
                    <button type="button" aria-label="清除搜索" onClick={() => setSearch('')}>
                      <IconX size={14} />
                    </button>
                  )}
                </label>
                <div className={styles.toolbarActions}>
                  {libraryView === 'TRASH' && (
                    <button
                      type="button"
                      aria-label="恢复当前素材"
                      disabled={!selectedAssetId || restoreMutation.isPending}
                      onClick={() => {
                        if (selectedAssetId) restoreMutation.mutate([selectedAssetId]);
                      }}
                    >
                      <IconRefresh size={18} />
                      恢复
                    </button>
                  )}
                  {libraryView === 'TRASH' && (
                    <button
                      className={styles.dangerAction}
                      type="button"
                      aria-label="清空回收站"
                      disabled={assets.length === 0 || emptyTrashMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm('确认清空回收站？其中的全部素材将被永久删除，且无法恢复。')
                        ) {
                          emptyTrashMutation.mutate();
                        }
                      }}
                    >
                      <IconTrash size={18} />
                      清空
                    </button>
                  )}
                  <label
                    className={styles.thumbnailControl}
                    title={`缩略图大小：${thumbnailSize}px`}
                  >
                    <IconLayoutGrid size={17} aria-hidden="true" />
                    <input
                      type="range"
                      aria-label="缩略图大小"
                      min="140"
                      max="320"
                      step="10"
                      value={thumbnailSize}
                      onChange={(event) => setThumbnailSize(Number(event.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className={isInspectorOpen ? styles.filterActive : undefined}
                    aria-label={isInspectorOpen ? '隐藏素材详情' : '显示素材详情'}
                    aria-pressed={isInspectorOpen}
                    onClick={() => setIsInspectorVisible((value) => !value)}
                  >
                    <IconLayoutSidebarRight size={18} />
                    详情
                  </button>
                </div>
              </div>

              {libraryView === 'ACTIVE' ? (
                <EagleQuickFilterBar
                  value={quickFilters}
                  manualTags={manualTags}
                  aiTags={aiTags}
                  onChange={setQuickFilters}
                />
              ) : null}

              {uploadStatus && (
                <div className={styles.statusBar} role="status">
                  {uploadStatus}
                </div>
              )}
              {color && colorCoverage && colorCoverage.percentage < 100 ? (
                <div className={styles.statusBar} role="status">
                  颜色结果仍在补全：{colorCoverage.completed}/{colorCoverage.eligible} 已分析（
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
              <div
                ref={assetViewport.containerRef}
                className={styles.assetViewport}
                role="region"
                aria-label="素材瀑布流"
                onClick={clearAssetSelection}
                onScroll={(event) => assetViewport.handleScroll(event.currentTarget.scrollTop)}
              >
                {assetsQuery.isLoading && (
                  <div className={styles.emptyState}>正在加载个人素材库…</div>
                )}
                {assetsQuery.isError && (
                  <div className={styles.emptyState}>
                    加载失败：{assetsQuery.error.message}
                    <button type="button" onClick={() => void assetsQuery.refetch()}>
                      重试
                    </button>
                  </div>
                )}
                {!assetsQuery.isLoading && !assetsQuery.isError && assets.length === 0 && (
                  <div className={styles.emptyState}>
                    <span className={styles.emptyMark}>
                      <img src={sekerEagleLogo} alt="" />
                    </span>
                    <strong>
                      {search
                        ? '没有匹配的素材'
                        : libraryView === 'TRASH'
                          ? '回收站是空的'
                          : libraryView === 'PRIVATE'
                            ? '暂无隐私素材'
                            : '把第一份灵感放进来'}
                    </strong>
                    <p>
                      {search
                        ? '尝试其他名称或标签。'
                        : libraryView === 'TRASH'
                          ? '移除的素材会暂时保留在这里。'
                          : libraryView === 'PRIVATE'
                            ? '通过素材右键菜单设为隐私。'
                            : '将图片或 MP4 拖入此处。'}
                    </p>
                  </div>
                )}
                <div
                  ref={masonryRef}
                  className={styles.masonry}
                  style={{ height: masonryLayout.height }}
                >
                  {visibleMasonryItems.map((masonryItem) => {
                    const asset = assetsById.get(masonryItem.id);
                    if (!asset) return null;
                    const isSelected = selectedAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={`${styles.assetCard} ${isSelected ? styles.assetCardSelected : ''}`}
                        aria-pressed={isSelected}
                        aria-label={`${asset.displayName}，${asset.format.toUpperCase()}`}
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
                        onDoubleClick={() => openAssetPreview(asset)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectAsset(asset.id, 'single');
                            openAssetPreview(asset);
                          }
                        }}
                      >
                        <span
                          className={styles.preview}
                          style={{ height: masonryItem.previewHeight }}
                        >
                          {isBatchSelection && (
                            <span className={styles.selectionMark}>
                              {isSelected && <IconCheck size={13} />}
                            </span>
                          )}
                          <EagleAssetThumbnail
                            asset={asset}
                            scheduler={thumbnailScheduler}
                            order={-masonryItem.top}
                            displayWidth={thumbnailSize}
                          />
                          {asset.lifecycleStatus !== 'READY' && (
                            <span className={styles.processing}>
                              {asset.lifecycleStatus === 'FAILED' ? '处理失败' : '处理中'}
                            </span>
                          )}
                          {asset.isPrivate && (
                            <span className={styles.privateMark} title="隐私素材">
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
                  <div className={styles.pageLoading}>正在加载更多素材…</div>
                )}
              </div>
            </>
          )}
        </section>

        {isInspectorOpen && (
          <aside className={styles.inspector} aria-label="素材详情">
            <div className={styles.inspectorHeader}>
              <div>
                <strong>素材详情</strong>
                {selectedAssetIds.length > 1 && <span>已选择 {selectedAssetIds.length} 项</span>}
              </div>
              <button
                type="button"
                aria-label="关闭素材详情"
                onClick={() => setIsInspectorVisible(false)}
              >
                <IconX size={17} />
              </button>
            </div>
            {selectedAssetId === null ? (
              <div className={styles.inspectorEmpty}>
                <IconPhoto size={28} />
                <span>选择一项素材查看详情</span>
              </div>
            ) : selectedAssetQuery.isPending ? (
              <div className={styles.inspectorEmpty} role="status">
                <IconPhoto size={28} />
                <span>正在加载素材详情…</span>
              </div>
            ) : selectedAssetQuery.isError ? (
              <div className={styles.inspectorEmpty} role="alert">
                <IconPhoto size={28} />
                <span>加载失败：{selectedAssetQuery.error.message}</span>
                <button type="button" onClick={() => void selectedAssetQuery.refetch()}>
                  重试加载素材详情
                </button>
              </div>
            ) : selectedAsset ? (
              <>
                {isSelectedAssetReadOnly && (
                  <p className={styles.saveFeedback}>回收站中的素材信息为只读。</p>
                )}
                <section className={styles.detailSection}>
                  <div className={styles.annotationForm}>
                    <label>
                      标题
                      <input
                        aria-label="素材标题"
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
                  <h3>人工标签</h3>
                  <div className={styles.tagEditor}>
                    {selectedManualTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className={styles.tagAssigned}
                        aria-label={`移除人工标签 ${tag.name}`}
                        disabled={isSelectedAssetReadOnly || batchTagMutation.isPending}
                        onClick={() =>
                          batchTagMutation.mutate({
                            assetIds: selectedAssetIds,
                            removeTagIds: [tag.id],
                          })
                        }
                      >
                        {tag.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.tagAdd}
                      aria-label="添加人工标签"
                      disabled={isSelectedAssetReadOnly}
                      onClick={() => {
                        batchTagMutation.reset();
                        createBatchTagMutation.reset();
                        setTagPickerAssetIds([...selectedAssetIds]);
                      }}
                    >
                      <IconPlus size={14} />
                      添加标签…
                    </button>
                  </div>
                  {batchTagMutation.isError && (
                    <p className={styles.inlineError}>{batchTagMutation.error.message}</p>
                  )}
                </section>
                <section className={styles.detailSection}>
                  <h3>
                    <IconSparkles size={15} />
                    AI 自动标签
                  </h3>
                  <div className={styles.tagList}>
                    {selectedAsset.aiTags.length ? (
                      selectedAsset.aiTags.map((tag) => <span key={tag.id}>{tag.name}</span>)
                    ) : (
                      <em>AI 分析尚未启用</em>
                    )}
                  </div>
                </section>
                <form
                  ref={metadataFormRef}
                  id="eagle-asset-metadata-form"
                  className={`${styles.detailSection} ${styles.annotationForm}`}
                >
                  <label>
                    描述
                    <textarea
                      aria-label="素材描述"
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
                    来源
                    <input
                      aria-label="素材来源链接"
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
                    正在自动保存…
                  </p>
                )}
                {metadataMutation.isSuccess && !editorDirtyRef.current && (
                  <p className={styles.saveFeedback} role="status">
                    已自动保存
                  </p>
                )}
                {metadataMutation.isError && (
                  <div className={styles.saveFeedback}>
                    <p className={styles.inlineError} role="alert">
                      自动保存失败：{metadataMutation.error.message}
                    </p>
                    <button type="button" onClick={saveEditedMetadata}>
                      重试
                    </button>
                  </div>
                )}
                <section className={styles.detailSection}>
                  <h3>星级</h3>
                  <div className={styles.rating} aria-label="星级评分">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        type="button"
                        aria-label={`${rating} 星`}
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
                    <h3>颜色</h3>
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
                  <h3>完整属性</h3>
                  <dl>
                    <div>
                      <dt>原始文件名</dt>
                      <dd>{selectedAsset.originalName}</dd>
                    </div>
                    <div>
                      <dt>格式</dt>
                      <dd>{selectedAsset.format.toUpperCase()}</dd>
                    </div>
                    <div>
                      <dt>MIME</dt>
                      <dd>{selectedAsset.mimeType}</dd>
                    </div>
                    <div>
                      <dt>尺寸</dt>
                      <dd>
                        {selectedAsset.width && selectedAsset.height
                          ? `${selectedAsset.width} × ${selectedAsset.height}`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>时长</dt>
                      <dd>
                        {selectedAsset.durationMs
                          ? `${(selectedAsset.durationMs / 1000).toFixed(1)} 秒`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>大小</dt>
                      <dd>{formatBytes(selectedAsset.byteSize)}</dd>
                    </div>
                    <div>
                      <dt>处理状态</dt>
                      <dd>
                        {selectedAsset.lifecycleStatus === 'READY'
                          ? '可用'
                          : selectedAsset.lifecycleStatus === 'FAILED'
                            ? '失败'
                            : '处理中'}
                      </dd>
                    </div>
                    <div>
                      <dt>添加时间</dt>
                      <dd>{new Date(selectedAsset.createdAt).toLocaleDateString('zh-CN')}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>{new Date(selectedAsset.updatedAt).toLocaleString('zh-CN')}</dd>
                    </div>
                    <div>
                      <dt>素材 ID</dt>
                      <dd>{selectedAsset.id}</dd>
                    </div>
                  </dl>
                </section>
              </>
            ) : (
              <div className={styles.inspectorEmpty}>
                <IconPhoto size={28} />
                <span>选择一项素材查看详情</span>
              </div>
            )}
          </aside>
        )}
      </div>

      {assetContextMenu && selectedAssetIds.length > 0 && (
        <>
          <button
            className={styles.contextMenuDismiss}
            type="button"
            aria-label="关闭素材操作菜单"
            onClick={() => setAssetContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setAssetContextMenu(null);
            }}
          />
          <div
            className={styles.contextMenu}
            role="menu"
            aria-label="素材操作"
            style={{ left: assetContextMenu.x, top: assetContextMenu.y }}
          >
            <div className={styles.contextMenuTitle}>已选择 {selectedAssetIds.length} 项</div>
            {(libraryView === 'ACTIVE' || libraryView === 'PRIVATE') && (
              <button
                type="button"
                role="menuitem"
                aria-label="添加标签"
                disabled={batchTagMutation.isPending}
                onClick={() => {
                  setAssetContextMenu(null);
                  batchTagMutation.reset();
                  createBatchTagMutation.reset();
                  setTagPickerAssetIds([...selectedAssetIds]);
                }}
              >
                <IconTags size={15} />
                添加标签…
              </button>
            )}
            {(libraryView === 'ACTIVE' || libraryView === 'PRIVATE') && (
              <button
                type="button"
                role="menuitem"
                aria-label={
                  selectedAssetIds.every((assetId) => assetsById.get(assetId)?.isPrivate)
                    ? '移出隐私'
                    : '设为隐私'
                }
                disabled={privacyMutation.isPending}
                onClick={() => {
                  const isPrivate = !selectedAssetIds.every(
                    (assetId) => assetsById.get(assetId)?.isPrivate,
                  );
                  privacyMutation.mutate({ assets: selectedAssetVersions, isPrivate });
                }}
              >
                <IconLock size={15} />
                {selectedAssetIds.every((assetId) => assetsById.get(assetId)?.isPrivate)
                  ? '移出隐私'
                  : '设为隐私'}
              </button>
            )}
            {libraryView === 'ACTIVE' || libraryView === 'PRIVATE' ? (
              <button
                className={styles.contextMenuDanger}
                type="button"
                role="menuitem"
                aria-label="删除所选素材"
                disabled={trashMutation.isPending}
                onClick={() => trashMutation.mutate(selectedAssetIds)}
              >
                <IconTrash size={15} />
                删除（移到回收站）
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                aria-label="恢复所选素材"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(selectedAssetIds)}
              >
                <IconRefresh size={15} />
                恢复
              </button>
            )}
          </div>
        </>
      )}

      {tagPickerAssetIds && tagPickerAssetIds.length > 0 && (
        <EagleBatchTagPicker
          assetCount={tagPickerAssetIds.length}
          tags={manualTags}
          pending={batchTagMutation.isPending}
          error={(batchTagMutation.error ?? createBatchTagMutation.error)?.message}
          onCreate={(name) => createBatchTagMutation.mutateAsync(name)}
          onClose={() => setTagPickerAssetIds(null)}
          onApply={(tagIds) =>
            batchTagMutation.mutate({
              assetIds: tagPickerAssetIds,
              addTagIds: tagIds,
            })
          }
        />
      )}

      {isDragging && (
        <div className={styles.dropOverlay}>
          <IconPlus size={32} />
          <strong>松手导入素材</strong>
          <span>支持批量图片和 MP4</span>
        </div>
      )}
      {previewAsset && (
        <EagleAssetLightbox asset={previewAsset} onClose={() => setPreviewAssetId(null)} />
      )}
      {imagePreview.previewImage ? (
        <EagleImageViewer
          image={imagePreview.previewImage}
          descriptor={previewPyramidQuery.data}
          onClose={imagePreview.closePreview}
        />
      ) : null}
      {isSmartFolderDialogOpen && (
        <EagleSmartFolderDialog
          accessToken={accessToken}
          initialQuery={
            editingSmartFolder ? toEagleFilterQuery(editingSmartFolder.queryJson) : filterQuery
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
    </main>
  );
}
