// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEagleSelectionController } from './useEagleSelectionController';

describe('workspace selection ownership', () => {
  it('owns range anchors and clears the complete interaction on navigation', () => {
    const { result } = renderHook(() => useEagleSelectionController());
    act(() => result.current.select(['a', 'b', 'c'], 'a', 'single'));
    act(() => result.current.select(['a', 'b', 'c'], 'c', 'range'));
    expect(result.current.selectedAssetIds).toEqual(['a', 'b', 'c']);
    act(() => result.current.setSelectionMode(true));
    act(() => result.current.clear());
    expect(result.current.selectedAssetIds).toEqual([]);
    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.isBatchSelection).toBe(false);
    expect(result.current.selectionMode).toBe(false);
    act(() => result.current.select(['a', 'b', 'c'], 'b', 'range'));
    expect(result.current.selectedAssetIds).toEqual(['b']);
  });

  it('resets filtered selection while preserving the explicit selection tool', () => {
    const { result } = renderHook(() =>
      useEagleSelectionController({
        selectedAssetIds: ['a'],
        selectedAssetId: 'a',
        selectionMode: true,
        isBatchSelection: true,
      }),
    );
    act(() => result.current.clear({ preserveMode: true }));
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedAssetIds).toEqual([]);
    expect(result.current.selectedAssetId).toBeNull();
  });

  it('prunes removed members without losing selection on page growth', () => {
    const { result } = renderHook(() =>
      useEagleSelectionController({ selectedAssetIds: ['a', 'b'], selectedAssetId: 'b' }),
    );
    act(() => result.current.reconcile(new Set(['a', 'b', 'c'])));
    expect(result.current.selectedAssetIds).toEqual(['a', 'b']);
    act(() => result.current.reconcile(new Set(['a', 'c'])));
    expect(result.current.selectedAssetIds).toEqual(['a']);
    expect(result.current.selectedAssetId).toBeNull();
  });
});
