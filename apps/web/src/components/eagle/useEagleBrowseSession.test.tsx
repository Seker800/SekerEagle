// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyEagleQuickFilterState } from './eagle-quick-filter-state';
import { useEagleBrowseSession } from './useEagleBrowseSession';

const selection = {
  selectedAssetIds: [],
  selectedAssetId: null,
  isBatchSelection: false,
  selectionMode: false,
};

function makeCache(browse: Record<string, unknown> | null = null) {
  return { browse } as never;
}

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

it('restores the saved browse session for a public workspace', () => {
  const workspaceCache = makeCache({
    search: 'cat',
    quickFilters: createEmptyEagleQuickFilterState(),
    activeSmartFolderId: null,
    smartFolderOrder: 'DATE',
    libraryView: 'ACTIVE',
    photoView: 'timeline',
    filtersExpanded: true,
    selectedAssetIds: [],
    selectedAssetId: null,
    isInspectorVisible: true,
    isBatchSelection: false,
    selectionMode: false,
  });
  const { result } = renderHook(() =>
    useEagleBrowseSession({
      ownerId: 'owner',
      libraryMode: 'MATERIAL',
      privateVisible: false,
      compact: false,
      privacyRulesRevision: 0,
      workspaceCache,
      selection,
    }),
  );

  expect(result.current.search).toBe('cat');
  expect(result.current.filtersExpanded).toBe(true);
  expect(result.current.isInspectorVisible).toBe(true);
  expect(result.current.thumbnailSize).toBe(210);
});

it('ignores saved browse state when the private scope is active', () => {
  const workspaceCache = makeCache({
    search: 'secret',
    quickFilters: createEmptyEagleQuickFilterState(),
    activeSmartFolderId: null,
    smartFolderOrder: 'RELEVANCE',
    libraryView: 'PRIVATE',
    photoView: 'map',
    filtersExpanded: true,
    selectedAssetIds: [],
    selectedAssetId: null,
    isInspectorVisible: true,
    isBatchSelection: false,
    selectionMode: false,
  });
  const { result } = renderHook(() =>
    useEagleBrowseSession({
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      privateVisible: true,
      compact: false,
      privacyRulesRevision: 0,
      workspaceCache,
      selection,
    }),
  );

  expect(result.current.search).toBe('');
  expect(result.current.libraryView).toBe('ACTIVE');
  expect(result.current.photoView).toBe('timeline');
  expect(result.current.smartFolderOrder).toBe('DATE');
  expect(result.current.filtersExpanded).toBe(false);
  expect(result.current.isInspectorVisible).toBe(false);
});

it('reads and persists the thumbnail size per owner and mode', () => {
  const key = `seker-eagle.preferences.v1:${JSON.stringify(['owner', 'MATERIAL'])}`;
  window.localStorage.setItem(key, JSON.stringify({ thumbnailSize: 260 }));
  const { result } = renderHook(() =>
    useEagleBrowseSession({
      ownerId: 'owner',
      libraryMode: 'MATERIAL',
      privateVisible: false,
      compact: false,
      privacyRulesRevision: 0,
      workspaceCache: makeCache(),
      selection,
    }),
  );

  expect(result.current.thumbnailSize).toBe(260);
  act(() => result.current.setThumbnailSize(280));
  expect(JSON.parse(window.localStorage.getItem(key) ?? '{}')).toEqual({
    thumbnailSize: 280,
    photoSort: 'CAPTURED_AT',
  });
});

it('reads and persists the photo ordering per owner and mode', () => {
  const key = `seker-eagle.preferences.v1:${JSON.stringify(['owner', 'PHOTO'])}`;
  window.localStorage.setItem(key, JSON.stringify({ photoSort: 'ADDED_AT' }));
  const { result } = renderHook(() =>
    useEagleBrowseSession({
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      privateVisible: false,
      compact: false,
      privacyRulesRevision: 0,
      workspaceCache: makeCache(),
      selection,
    }),
  );

  expect(result.current.photoSort).toBe('ADDED_AT');
  act(() => result.current.setPhotoSort('CAPTURED_AT'));
  expect(JSON.parse(window.localStorage.getItem(key) ?? '{}')).toMatchObject({
    photoSort: 'CAPTURED_AT',
  });
});

it('resets the timeline cursor after the debounced search changes', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() =>
    useEagleBrowseSession({
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      privateVisible: false,
      compact: false,
      privacyRulesRevision: 0,
      workspaceCache: makeCache(),
      selection,
    }),
  );

  act(() => result.current.setTimelineCursor('cursor-1'));
  act(() => result.current.setSearch('mountain'));
  act(() => vi.advanceTimersByTime(300));

  expect(result.current.deferredSearch).toBe('mountain');
  expect(result.current.timelineCursor).toBe('');
});
