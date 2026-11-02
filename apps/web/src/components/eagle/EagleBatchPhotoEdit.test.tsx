import { writePortableLut } from '@sekereagle/photo-render-core/portable-lut';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { EagleBatchPhotoEdit } from './EagleBatchPhotoEdit';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), context: vi.fn(), loadLut: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    api: { batchEditEaglePhotos: mocks.enqueue, getBatchEaglePhotoEditContext: mocks.context },
  }),
}));
vi.mock('../media/photo-editor/photo-lut-storage', () => ({ loadPhotoLut: mocks.loadLut }));
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
  mocks.enqueue.mockReset().mockResolvedValue({ id: 'operation', kind: 'BACKGROUND_COMMAND' });
  mocks.context.mockReset().mockResolvedValue({ preservedFilterIds: [] });
  mocks.loadLut.mockReset();
});
it('submits the whole selection once and closes after durable acceptance without reading or rendering photos', async () => {
  const close = vi.fn(),
    resolveSession = vi.fn();
  const recipe = { version: 1 as const, edits: DEFAULT_PHOTO_EDITS };
  render(
    <EagleBatchPhotoEdit
      assetIds={['a', 'b', 'a']}
      recipe={recipe}
      resolveSession={resolveSession}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('', {
    operationId: expect.any(String),
    assetIds: ['a', 'b'],
    recipe,
    parts: { adjustments: true, filter: true, watermark: true, crop: false },
  });
  expect(resolveSession).not.toHaveBeenCalled();
});
it('can close while acceptance is pending and does not cancel durable execution', async () => {
  mocks.enqueue.mockReturnValue(new Promise(() => undefined));
  const close = vi.fn();
  render(
    <EagleBatchPhotoEdit
      assetIds={['a']}
      recipe={{ version: 1, edits: DEFAULT_PHOTO_EDITS }}
      resolveSession={vi.fn()}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0]);
  expect(close).toHaveBeenCalledOnce();
});
it('keeps the selected options available to retry an admission error', async () => {
  mocks.enqueue.mockRejectedValueOnce(new Error('connection unavailable'));
  const close = vi.fn();
  render(
    <EagleBatchPhotoEdit
      assetIds={['a']}
      recipe={{ version: 1, edits: DEFAULT_PHOTO_EDITS }}
      resolveSession={vi.fn()}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('connection unavailable');
  expect(screen.getByRole('button', { name: '开始套用' })).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
});

it('reuses the same render intent on a lost response and assigns a new intent when settings change', async () => {
  mocks.enqueue.mockRejectedValue(new Error('connection unavailable'));
  render(
    <EagleBatchPhotoEdit
      assetIds={['a']}
      recipe={{ version: 1, edits: DEFAULT_PHOTO_EDITS }}
      resolveSession={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await screen.findByRole('alert');
  const first = mocks.enqueue.mock.calls[0][1].operationId;
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '开始套用' })).toBeEnabled());
  expect(mocks.enqueue.mock.calls[1][1].operationId).toBe(first);
  fireEvent.click(screen.getByRole('checkbox', { name: '水印' }));
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(3));
  expect(mocks.enqueue.mock.calls[2][1].operationId).not.toBe(first);
});

it('preserves the local LUT of legacy browser-uploaded or draft targets when their filter is not pasted', async () => {
  const table = {
    size: 2,
    data: new Float32Array(24),
    domainMin: [0, 0, 0] as [number, number, number],
    domainMax: [1, 1, 1] as [number, number, number],
  };
  mocks.context.mockResolvedValue({
    preservedFilterIds: ['lut:legacy-target', 'lut:legacy-target'],
  });
  mocks.loadLut.mockResolvedValue(table);
  const recipe = {
    version: 1 as const,
    edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:clipboard' as const, exposure: 25 },
  };
  const resolveSession = vi.fn();
  const close = vi.fn();
  render(
    <EagleBatchPhotoEdit
      assetIds={['legacy-copy', 'draft-target', 'legacy-copy']}
      recipe={recipe}
      resolveSession={resolveSession}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: '滤镜' }));
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith(['legacy-copy', 'draft-target']);
  expect(mocks.loadLut).toHaveBeenCalledExactlyOnceWith('legacy-target');
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
    '',
    expect.objectContaining({
      assetIds: ['legacy-copy', 'draft-target'],
      recipe,
      parts: expect.objectContaining({ filter: false }),
      preservedLuts: { 'lut:legacy-target': writePortableLut(table) },
    }),
  );
  expect(mocks.enqueue.mock.calls[0][1]).not.toHaveProperty('lut');
  expect(resolveSession).not.toHaveBeenCalled();
});

it('does not enqueue or read local tables when the preserved-filter context is inaccessible', async () => {
  mocks.context.mockRejectedValue(new Error('photo unavailable'));
  render(
    <EagleBatchPhotoEdit
      assetIds={['hidden']}
      recipe={{ version: 1, edits: DEFAULT_PHOTO_EDITS }}
      resolveSession={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: '滤镜' }));
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('photo unavailable');
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.loadLut).not.toHaveBeenCalled();
});

it('does not read or upload unrelated local tables when preserved targets already have a durable server source', async () => {
  mocks.context.mockResolvedValue({ preservedFilterIds: [] });
  const close = vi.fn();
  render(
    <EagleBatchPhotoEdit
      assetIds={['durable-target']}
      recipe={{ version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:unrelated-clipboard' } }}
      resolveSession={vi.fn()}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: '滤镜' }));
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.loadLut).not.toHaveBeenCalled();
  expect(mocks.enqueue.mock.calls[0][1]).not.toHaveProperty('preservedLuts');
  expect(mocks.enqueue.mock.calls[0][1]).not.toHaveProperty('lut');
});
