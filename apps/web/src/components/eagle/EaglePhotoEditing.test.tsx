import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import {
  EagleEditPhotoButton,
  EaglePhotoEditorDialog,
  eaglePhotoWatermarkMetadata,
  useEaglePhotoEditing,
} from './EaglePhotoEditing';

const state = vi.hoisted(() => ({
  mode: 'MATERIAL' as 'MATERIAL' | 'PHOTO',
  upload: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    libraryMode: state.mode,
    api: { uploadEagleAsset: state.upload },
  }),
}));
vi.mock('../media/photo-editor/PhotoEditor', () => ({
  PhotoEditor: ({ onOpenSaved }: { onOpenSaved: (id: string) => Promise<void> }) => (
    <button onClick={() => void onOpenSaved('copy')}>查看已保存照片</button>
  ),
}));
const asset = {
  id: 'source',
  displayName: 'Original',
  mimeType: 'image/png',
  lifecycleStatus: 'READY',
  rowVersion: 7,
  mediaRevision: 2,
  deletedAt: null,
  renditions: [],
  libraryMode: 'MATERIAL',
} as unknown as EagleAssetListItem;
const raw = {
  ...asset,
  mimeType: 'image/x-fuji-raf',
  renditions: [
    { id: 'edit', kind: 'PREVIEW', variant: 'edit', revision: 2, mimeType: 'image/webp' },
  ],
} as EagleAssetListItem;
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  state.mode = 'MATERIAL';
  state.upload.mockReset();
});
describe('shared library photo editing', () => {
  it('keeps unsupported, deleted and processing resources out of the edit flow', () => {
    const edit = vi.fn();
    const view = render(<EagleEditPhotoButton asset={asset} onEdit={edit} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑照片' }));
    expect(edit).toHaveBeenCalledWith(asset);
    for (const next of [
      { ...asset, mimeType: 'video/mp4' },
      { ...asset, deletedAt: 'today' },
      { ...asset, lifecycleStatus: 'PROCESSING' } as EagleAssetListItem,
    ]) {
      view.rerender(<EagleEditPhotoButton asset={next} onEdit={edit} />);
      expect(screen.queryByRole('button')).toBeNull();
    }
    view.rerender(<EagleEditPhotoButton asset={asset} />);
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<EagleEditPhotoButton asset={raw} onEdit={edit} role="menuitem" />);
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑 RAW 显影副本' }));
    expect(edit).toHaveBeenLastCalledWith(raw);
  });
  it('freezes source version and upload scope, and isolates list refresh failure from save completion', async () => {
    const { wrapper, client } = harness();
    const view = renderHook(
      ({ scopeKey }) => useEaglePhotoEditing({ accessToken: 'token', ownerId: 'owner', scopeKey }),
      { wrapper, initialProps: { scopeKey: 'owner:MATERIAL' } },
    );
    const source = { ...asset };
    act(() => view.result.current.open(source));
    const session = view.result.current.session!;
    source.rowVersion = 99;
    source.displayName = 'Changed';
    state.upload.mockResolvedValue({ asset: { id: 'copy' } });
    const refresh = vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('offline'));
    const file = new File(['png'], 'output.png');
    expect(await session.onSave(file)).toEqual({ id: 'copy', name: 'output.png' });
    expect(state.upload).toHaveBeenCalledWith('token', file, expect.any(Function), {
      duplicatePolicy: 'CREATE_COPY',
      copySourceAssetId: 'source',
      copySourceRowVersion: 7,
      retry: true,
    });
    expect(session.name).toBe('Original');
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['eagle', 'owner', 'MATERIAL', 'assets'] });
    view.rerender({ scopeKey: 'owner:PHOTO' });
    expect(view.result.current.session).toBeNull();
  });
  it('opens a current RAW rendition in PHOTO and rejects foreign-mode and unavailable sources', async () => {
    state.mode = 'PHOTO';
    const { wrapper, client } = harness();
    const { result } = renderHook(
      () => useEaglePhotoEditing({ accessToken: '', ownerId: 'owner', scopeKey: 'photo' }),
      { wrapper },
    );
    act(() => result.current.open(asset));
    expect(result.current.session).toBeNull();
    act(() => result.current.open({ ...raw, libraryMode: 'PHOTO', renditions: [] }));
    expect(result.current.session).toBeNull();
    act(() => result.current.open({ ...raw, libraryMode: 'PHOTO' }));
    expect(result.current.session?.source).toBe('/api/photos/assets/source/renditions/edit');
    const refresh = vi.spyOn(client, 'invalidateQueries');
    state.upload.mockResolvedValue({ asset: { id: 'copy' } });
    await result.current.session!.onSave(new File(['png'], 'output.png'));
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['eagle', 'owner', 'PHOTO', 'assets'] });
    act(() => result.current.close());
    expect(result.current.session).toBeNull();
  });
  it('propagates upload failure for the existing editor retry flow', async () => {
    const { wrapper } = harness();
    const { result } = renderHook(
      () => useEaglePhotoEditing({ accessToken: '', ownerId: 'owner', scopeKey: 'scope' }),
      { wrapper },
    );
    act(() => result.current.open(asset));
    state.upload.mockRejectedValue(new Error('source changed'));
    await expect(result.current.session!.onSave(new File(['png'], 'output.png'))).rejects.toThrow(
      'source changed',
    );
    expect(result.current.session).not.toBeNull();
  });
  it('only passes photographic display fields and preserves original capture wall time', () => {
    expect(eaglePhotoWatermarkMetadata(asset)).toEqual({});
    const metadata = {
      cameraMake: 'NIKON CORPORATION',
      cameraModel: 'NIKON Z5',
      focalLength: 50,
      aperture: 2.8,
      exposureSeconds: 1 / 125,
      iso: 200,
      capturedLocal: '2026-10-20T12:30:00',
      capturedAt: '2026-10-20T04:30:00Z',
      latitude: 31,
    } as NonNullable<EagleAssetListItem['photoMetadata']>;
    expect(eaglePhotoWatermarkMetadata({ ...asset, photoMetadata: metadata })).toEqual({
      camera: 'NIKON Z5',
      parameters: '50mm  ·  f/2.8  ·  1/125s  ·  ISO 200',
      capturedAt: '2026.10.20 12:30',
    });
    expect(
      eaglePhotoWatermarkMetadata({ ...asset, photoMetadata: { ...metadata, capturedLocal: null } })
        .capturedAt,
    ).toBeUndefined();
  });
  it('locates the saved asset before dismissing the editor', async () => {
    const { wrapper } = harness();
    const { result } = renderHook(
      () => useEaglePhotoEditing({ accessToken: '', ownerId: 'owner', scopeKey: 'scope' }),
      { wrapper },
    );
    act(() => result.current.open(asset));
    const close = vi.fn(),
      locate = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <EaglePhotoEditorDialog session={null} onClose={close} onOpenSaved={locate} />,
    );
    view.rerender(
      <EaglePhotoEditorDialog
        session={result.current.session}
        onClose={close}
        onOpenSaved={locate}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '查看已保存照片' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(locate).toHaveBeenCalledWith('copy');
    expect(locate.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });
});
