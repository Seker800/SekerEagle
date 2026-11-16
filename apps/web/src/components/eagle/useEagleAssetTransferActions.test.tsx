// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { useEagleAssetTransferActions } from './useEagleAssetTransferActions';

const asset = {
  id: 'asset-1',
  mimeType: 'image/jpeg',
} as EagleAssetListItem;

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    libraryMode: 'MATERIAL' as const,
    libraryView: 'ACTIVE' as const,
    ownerId: 'owner-a',
    accessToken: '',
    assets: [asset],
    selectedAssetIds: [],
    contextMenuAsset: null,
    workspaceCache: {
      downloads: { epoch: 0, enqueue: vi.fn() },
    } as never,
    getEagleAsset: vi.fn(async () => asset),
    selectAsset: vi.fn(),
    setAssetContextMenu: vi.fn(),
    importFiles: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('clears transfer errors when the owner or mode changes', () => {
  const { result, rerender } = renderHook(
    ({ ownerId }) => useEagleAssetTransferActions(makeOptions({ ownerId })),
    { initialProps: { ownerId: 'owner-a' } },
  );

  act(() => result.current.setOriginalFileError({ message: 'failed', id: 1 }));
  expect(result.current.originalFileError).toEqual({ message: 'failed', id: 1 });

  rerender({ ownerId: 'owner-b' });
  expect(result.current.originalFileError).toBeNull();
  expect(result.current.assetDragStatus).toBeNull();
});

it('auto-clears an original-file error after six seconds', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useEagleAssetTransferActions(makeOptions()));

  act(() => result.current.setOriginalFileError({ message: 'failed', id: 1 }));
  act(() => vi.advanceTimersByTime(6_000));

  expect(result.current.originalFileError).toBeNull();
});

it('tracks file drags and imports dropped files', () => {
  const importFiles = vi.fn();
  const { result } = renderHook(() =>
    useEagleAssetTransferActions(makeOptions({ importFiles })),
  );
  const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
  const preventDefault = vi.fn();
  const event = {
    preventDefault,
    dataTransfer: { types: ['Files'], files: [file] },
  } as unknown as React.DragEvent<HTMLElement>;

  act(() => result.current.handleDragEnter(event));
  expect(result.current.isDragging).toBe(true);
  expect(preventDefault).toHaveBeenCalled();

  act(() => result.current.handleDrop(event));
  expect(importFiles).toHaveBeenCalledWith([file]);
  expect(result.current.isDragging).toBe(false);
});

it('ignores file drags while a processing or account view is active', () => {
  const { result } = renderHook(() =>
    useEagleAssetTransferActions(makeOptions({ libraryView: 'PROCESSING' })),
  );
  const preventDefault = vi.fn();
  const event = {
    preventDefault,
    dataTransfer: { types: ['Files'], files: [] },
  } as unknown as React.DragEvent<HTMLElement>;

  act(() => result.current.handleDragEnter(event));
  expect(result.current.isDragging).toBe(false);
  expect(preventDefault).not.toHaveBeenCalled();
});
