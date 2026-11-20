import { useEffect, useId, useMemo, useState } from 'react';
import { hashKey } from '@tanstack/react-query';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { EagleAssetSort } from '../../lib/eagle-api';
import type { LibraryMode } from '../../lib/library-api-scope';
import {
  buildEagleQuickFilterQuery,
  countActiveEagleQuickFilters,
  createEmptyEagleQuickFilterState,
  type EagleQuickFilterState,
} from './eagle-quick-filter-state';
import type {
  getEagleWorkspaceCache,
  EagleLibraryView,
  EaglePhotoView,
} from './eagle-workspace-cache';

type EagleWorkspaceSection = 'TAGS' | 'PENDING' | 'SETTINGS' | 'TASKS';

const EAGLE_PREFERENCES_KEY = 'seker-eagle.preferences.v1';
const DEFAULT_THUMBNAIL_SIZE = 210;

function getWorkspaceSection(view: EagleLibraryView): EagleWorkspaceSection | null {
  if (view === 'MANUAL_TAGS') return 'TAGS';
  if (view === 'PROCESSING') return 'TASKS';
  if (view === 'VECTOR_REVIEW' || view === 'VECTOR_UNCLASSIFIED') return 'PENDING';
  if (view === 'VECTOR_TAGS' || view === 'ACCOUNT') return 'SETTINGS';
  return null;
}

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

function readPhotoSort(preferencesKey = EAGLE_PREFERENCES_KEY): EagleAssetSort {
  try {
    const preferences: unknown = JSON.parse(window.localStorage.getItem(preferencesKey) ?? '{}');
    const value =
      typeof preferences === 'object' && preferences !== null && 'photoSort' in preferences
        ? preferences.photoSort
        : undefined;
    return value === 'ADDED_AT' ? 'ADDED_AT' : 'CAPTURED_AT';
  } catch {
    return 'CAPTURED_AT';
  }
}

export interface EagleBrowseSelectionSnapshot {
  selectedAssetIds: string[];
  selectedAssetId: string | null;
  isBatchSelection: boolean;
  selectionMode: boolean;
}

export function useEagleBrowseSession(options: {
  ownerId: string;
  libraryMode: LibraryMode;
  privateVisible: boolean;
  compact: boolean;
  privacyRulesRevision: number;
  workspaceCache: ReturnType<typeof getEagleWorkspaceCache>;
  selection: EagleBrowseSelectionSnapshot;
}) {
  const {
    ownerId,
    libraryMode,
    privateVisible,
    compact,
    privacyRulesRevision,
    workspaceCache,
    selection,
  } = options;
  const preferencesKey = `${EAGLE_PREFERENCES_KEY}:${JSON.stringify([ownerId, libraryMode])}`;

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
  const [smartFolderOrder, setSmartFolderOrder] = useState<'DATE' | 'RELEVANCE'>(() =>
    privateVisible ? 'DATE' : (workspaceCache.browse?.smartFolderOrder ?? 'DATE'),
  );
  const [activeSmartFolderId, setActiveSmartFolderId] = useState<string | null>(() =>
    !privateVisible && libraryView === 'ACTIVE' && photoView === 'timeline'
      ? (workspaceCache.browse?.activeSmartFolderId ?? null)
      : null,
  );
  const [filterResetKey, setFilterResetKey] = useState(0);
  const deferredSearch = useDebouncedValue(search.normalize('NFKC').trim(), 250, filterResetKey);
  const [quickFilters, setQuickFilters] = useState<EagleQuickFilterState>(
    () =>
      (!privateVisible && workspaceCache.browse?.quickFilters) ||
      createEmptyEagleQuickFilterState(),
  );
  const deferredQuickFilters = useDebouncedValue(quickFilters, 150, filterResetKey);
  const filterInputsPending =
    hashKey([quickFilters]) !== hashKey([deferredQuickFilters]) ||
    search.normalize('NFKC').trim() !== deferredSearch;
  const [filtersExpanded, setFiltersExpanded] = useState(
    () => !privateVisible && (workspaceCache.browse?.filtersExpanded ?? false),
  );
  const filterPanelId = useId();
  const [isInspectorVisible, setIsInspectorVisible] = useState(
    () => !privateVisible && (workspaceCache.browse?.isInspectorVisible ?? false),
  );
  const [timelineCursor, setTimelineCursor] = useState('');
  const [thumbnailSize, setThumbnailSize] = useState(() => readThumbnailSize(preferencesKey));
  const [photoSort, setPhotoSort] = useState<EagleAssetSort>(() => readPhotoSort(preferencesKey));

  useEffect(() => {
    window.localStorage.setItem(preferencesKey, JSON.stringify({ thumbnailSize, photoSort }));
  }, [thumbnailSize, photoSort, preferencesKey]);

  const activeFilterCount = countActiveEagleQuickFilters(quickFilters);
  const appliedFilterCount = countActiveEagleQuickFilters(deferredQuickFilters);
  const filterQuery = useMemo(
    () => buildEagleQuickFilterQuery(deferredQuickFilters),
    [deferredQuickFilters],
  );
  const workspaceSection = getWorkspaceSection(libraryView);
  const isAssetView =
    libraryView === 'ACTIVE' || libraryView === 'PRIVATE' || libraryView === 'TRASH';
  const showsAssetControls = libraryMode !== 'PHOTO' || photoView === 'timeline';
  const isPhotoTimeline =
    libraryMode === 'PHOTO' && photoView === 'timeline' && libraryView !== 'TRASH';
  const hasTimelineNavigation =
    isPhotoTimeline &&
    !compact &&
    libraryView === 'ACTIVE' &&
    !deferredSearch &&
    !activeFilterCount &&
    !activeSmartFolderId;

  useEffect(() => {
    setTimelineCursor('');
  }, [
    deferredSearch,
    activeFilterCount,
    activeSmartFolderId,
    privateVisible,
    privacyRulesRevision,
    libraryView,
    photoSort,
  ]);

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
        selectedAssetIds: selection.selectedAssetIds,
        selectedAssetId: selection.selectedAssetId,
        isInspectorVisible,
        isBatchSelection: selection.isBatchSelection,
        selectionMode: selection.selectionMode,
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
    selection.selectedAssetIds,
    selection.selectedAssetId,
    isInspectorVisible,
    selection.isBatchSelection,
    selection.selectionMode,
  ]);

  return {
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
    filterResetKey,
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
    photoSort,
    setPhotoSort,
    activeFilterCount,
    appliedFilterCount,
    filterQuery,
    workspaceSection,
    isAssetView,
    showsAssetControls,
    isPhotoTimeline,
    hasTimelineNavigation,
  };
}

export type { EagleWorkspaceSection };
