import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { EagleBatchPhotoEdit } from './EagleBatchPhotoEdit';
const mocks = vi.hoisted(() => ({ getAsset: vi.fn(), render: vi.fn(), dispose: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ api: { getEagleAsset: mocks.getAsset } }),
}));
vi.mock('../media/photo-editor/photo-editor-metadata', () => ({
  readPhotoMetadata: async () => ({}),
}));
vi.mock('../media/photo-editor/photo-editor-render', () => ({
  createPhotoRenderer: () => ({ dispose: mocks.dispose }),
}));
vi.mock('../media/photo-editor/photo-editor-export', () => ({
  loadEditablePhoto: async () => ({ src: '' }),
  renderEditedPhotoFile: mocks.render,
}));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  mocks.getAsset.mockReset().mockImplementation(async (_token, id) => ({ id, displayName: id }));
  mocks.render.mockReset().mockResolvedValue(new File(['png'], 'output.png'));
});
it('applies selected settings with target metadata and retries only unfinished outputs', async () => {
  const first = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue({ id: 'copy-a' }),
    second = vi.fn().mockResolvedValue({ id: 'copy-b' });
  const resolveSession = vi.fn().mockImplementation(async (asset) => ({
    source: `/${asset.id}`,
    name: asset.id,
    initialMetadata: { camera: asset.id },
    initialEdits: { ...DEFAULT_PHOTO_EDITS, cropZoom: 1.5 },
    onSave: asset.id === 'a' ? first : second,
  }));
  render(
    <EagleBatchPhotoEdit
      assetIds={['b', 'a']}
      recipe={{
        version: 1,
        edits: {
          ...DEFAULT_PHOTO_EDITS,
          exposure: 30,
          watermarkCamera: 'source camera',
          cropZoom: 2,
        },
      }}
      resolveSession={resolveSession}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole('checkbox', { name: '裁剪与旋转' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(second).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续未完成项' })).toBeEnabled());
  expect(mocks.render).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ cropZoom: 1.5, exposure: 30, watermarkCamera: null }),
    { camera: 'b' },
    expect.anything(),
    'b',
  );
  fireEvent.click(screen.getByRole('button', { name: '继续未完成项' }));
  await waitFor(() => expect(first).toHaveBeenCalledTimes(2));
  expect(second).toHaveBeenCalledOnce();
  expect(mocks.render).toHaveBeenCalledTimes(2);
});
it('stops after the active upload and resumes without duplicating its successful copy', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const saveA = vi.fn(() => pending),
    saveB = vi.fn().mockResolvedValue({ id: 'copy-b' });
  const resolveSession = vi.fn().mockImplementation(async (asset) => ({
    source: `/${asset.id}`,
    name: asset.id,
    initialMetadata: {},
    onSave: asset.id === 'a' ? saveA : saveB,
  }));
  render(
    <EagleBatchPhotoEdit
      assetIds={['a', 'b']}
      recipe={{ version: 1, edits: DEFAULT_PHOTO_EDITS }}
      resolveSession={resolveSession}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(saveA).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '停止后续处理' }));
  finish();
  await waitFor(() => expect(screen.getByRole('button', { name: '继续未完成项' })).toBeEnabled());
  expect(saveB).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续未完成项' }));
  await waitFor(() => expect(saveB).toHaveBeenCalledOnce());
  expect(saveA).toHaveBeenCalledOnce();
});
