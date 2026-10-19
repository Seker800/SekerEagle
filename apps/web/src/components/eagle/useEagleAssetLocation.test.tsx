import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEagleAssetLocation } from './useEagleAssetLocation';
import type { EagleAssetLocation } from '../../lib/eagle-api';
it('cancels stale owner/privacy requests and preserves the current view on errors', async () => {
  let resolve!: (value: EagleAssetLocation) => void;
  const getLocation = vi.fn(
    (_token: string, _id: string, _signal?: AbortSignal) =>
      new Promise<EagleAssetLocation>((done) => {
        resolve = done;
      }),
  );
  const onLocated = vi.fn();
  const view = renderHook(
    ({ scopeKey }) => useEagleAssetLocation({ getLocation, onLocated, scopeKey }),
    { initialProps: { scopeKey: 'owner:PHOTO:public' } },
  );
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.locate('old');
  });
  const signal = getLocation.mock.calls[0][2]!;
  view.rerender({ scopeKey: 'owner:PHOTO:private' });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve({ assetId: 'old', cursor: 'stale' });
    await pending;
  });
  expect(onLocated).not.toHaveBeenCalled();
  expect(view.result.current.location).toBeNull();
  getLocation.mockRejectedValueOnce(new Error('not found'));
  await act(async () => {
    await expect(view.result.current.locate('missing')).rejects.toThrow('not found');
  });
  expect(onLocated).not.toHaveBeenCalled();
  getLocation.mockResolvedValueOnce({ assetId: 'current', cursor: 'nearby' });
  await act(async () => {
    await view.result.current.locate('current');
  });
  expect(onLocated).toHaveBeenCalledOnce();
  expect(view.result.current.location).toEqual({ assetId: 'current', cursor: 'nearby' });
  act(() => view.result.current.clearLocation());
  expect(view.result.current.location).toBeNull();
});

it('centers and selects the real layout item, then focuses it without scrolling again', async () => {
  const { useEagleAssetLocationFocus } = await import('./useEagleAssetLocation');
  const element = document.createElement('div');
  const card = document.createElement('button');
  card.dataset.assetId = 'target';
  element.append(card);
  document.body.append(element);
  const scrollTo = vi.fn();
  element.scrollTo = scrollTo;
  const viewport = {
    elementRef: { current: element },
    viewportHeight: 600,
    scrollTop: 0,
    handleScroll: vi.fn(),
    containerRef: vi.fn(),
  };
  const onSelect = vi.fn();
  const location = { assetId: 'target', cursor: 'context' };
  const items = [{ id: 'target', top: 2000, height: 200 }];
  const { unmount, rerender } = renderHook(() =>
    useEagleAssetLocationFocus({
      location,
      targetId: 'target',
      items,
      viewport,
      enabled: true,
      onSelect,
    }),
  );
  expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'instant' });
  expect(onSelect).toHaveBeenCalledWith('target');
  await act(async () => {
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
  expect(document.activeElement).toBe(card);
  rerender();
  expect(scrollTo).toHaveBeenCalledOnce();
  unmount();
  element.remove();
});
