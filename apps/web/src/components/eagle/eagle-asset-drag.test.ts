import { describe, expect, it, vi } from 'vitest';
import { getAssetDragIds, getDesktopAssetDragBridge } from './eagle-asset-drag';

describe('getAssetDragIds', () => {
  const orderedIds = ['one', 'two', 'three'];

  it('drags the complete selection in visible library order when grabbing a selected card', () => {
    expect(
      getAssetDragIds({ orderedIds, selectedIds: ['three', 'one'], draggedId: 'three' }),
    ).toEqual(['one', 'three']);
  });

  it('drags only an unselected card instead of leaking the previous selection', () => {
    expect(
      getAssetDragIds({ orderedIds, selectedIds: ['one', 'two'], draggedId: 'three' }),
    ).toEqual(['three']);
  });
});

describe('getDesktopAssetDragBridge', () => {
  it('returns the capability only when the desktop bridge exposes it', () => {
    const prepareAssetDrag = vi.fn();
    const startPreparedAssetDrag = vi.fn();
    vi.stubGlobal('sekerDesktop', {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag,
      startPreparedAssetDrag,
    });
    expect(getDesktopAssetDragBridge()).toMatchObject({
      prepareAssetDrag,
      startPreparedAssetDrag,
    });
    vi.unstubAllGlobals();
  });

  it('keeps browser-only sessions non-draggable', () => {
    vi.stubGlobal('sekerDesktop', {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag: vi.fn(),
    });
    expect(getDesktopAssetDragBridge()).toBeNull();
    vi.unstubAllGlobals();
  });
});
