// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { useEagleAssetPreview } from './useEagleAssetPreview';

const image = { id: 'image', displayName: 'Image', mimeType: 'image/jpeg', lifecycleStatus: 'READY', mediaRevision: 1,
  renditions: [{ id: 'preview', revision: 1, kind: 'PREVIEW', mimeType: 'image/webp' }] } as EagleAssetListItem;
const video = { ...image, id: 'video', mimeType: 'video/mp4' };

it('replaces images, video and stack previews through one open and close lifecycle', () => {
  const { result } = renderHook(() => useEagleAssetPreview('owner:PHOTO:public'));
  act(() => result.current.open(image, [image, video]));
  expect(result.current.previewImage?.assetId).toBe('image');
  expect(result.current.assetId).toBeNull();
  act(() => result.current.open(video, [video]));
  expect(result.current.previewImage).toBeNull();
  expect(result.current.assetId).toBe('video');
  act(() => result.current.open(image, undefined, true));
  expect(result.current.assetId).toBe('image');
  expect(result.current.previewImage).toBeNull();
  act(() => result.current.closePreview());
  expect(result.current.assetId).toBeNull();
  expect(result.current.context).toBeNull();
});

it('drops private previews and their gallery context when the workspace scope changes', () => {
  const { result, rerender } = renderHook(({ scope }) => useEagleAssetPreview(scope), { initialProps: { scope: 'private' } });
  act(() => result.current.open(image, [image]));
  rerender({ scope: 'public' });
  expect(result.current.previewImage).toBeNull();
  expect(result.current.context).toBeNull();
  act(() => result.current.open(video, [video]));
  rerender({ scope: 'other-owner' });
  expect(result.current.assetId).toBeNull();
});

it('closes on Escape, restores scrolling and releases blob previews on replacement and unmount', () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revoke }));
  const { result, unmount } = renderHook(() => useEagleAssetPreview('scope'));
  act(() => result.current.setPreviewImage({ src: 'blob:one', alt: 'one' }));
  expect(document.body.style.overflow).toBe('hidden');
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(result.current.previewImage).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(revoke).toHaveBeenCalledWith('blob:one');
  act(() => result.current.setPreviewImage({ src: 'blob:two', alt: 'two' }));
  unmount();
  expect(revoke).toHaveBeenCalledWith('blob:two');
  vi.unstubAllGlobals();
});
