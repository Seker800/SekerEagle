import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { EagleBatchPhotoEdit } from './EagleBatchPhotoEdit';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ api: { batchEditEaglePhotos: mocks.enqueue } }),
}));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  mocks.enqueue.mockReset().mockResolvedValue({ id: 'operation', kind: 'BACKGROUND_COMMAND' });
});
it('submits the whole selection once and closes after durable acceptance without reading or rendering photos', async () => {
  const close = vi.fn(), resolveSession = vi.fn();
  const recipe = { version: 1 as const, edits: DEFAULT_PHOTO_EDITS };
  render(<EagleBatchPhotoEdit assetIds={['a','b','a']} recipe={recipe} resolveSession={resolveSession} onClose={close}/>);
  fireEvent.click(screen.getByRole('button', { name: '开始套用' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('', { assetIds: ['a','b'], recipe, parts: { adjustments: true, filter: true, watermark: true, crop: false } });
  expect(resolveSession).not.toHaveBeenCalled();
});
it('can close while acceptance is pending and does not cancel durable execution', async () => {
  mocks.enqueue.mockReturnValue(new Promise(() => undefined));
  const close = vi.fn();
  render(<EagleBatchPhotoEdit assetIds={['a']} recipe={{version:1, edits:DEFAULT_PHOTO_EDITS}} resolveSession={vi.fn()} onClose={close}/>);
  fireEvent.click(screen.getByRole('button', {name: '开始套用'}));
  fireEvent.click(screen.getAllByRole('button',{name:'关闭'})[0]);
  expect(close).toHaveBeenCalledOnce();
});
it('keeps the selected options available to retry an admission error', async () => {
  mocks.enqueue.mockRejectedValueOnce(new Error('connection unavailable'));
  const close = vi.fn();
  render(<EagleBatchPhotoEdit assetIds={['a']} recipe={{version:1, edits:DEFAULT_PHOTO_EDITS}} resolveSession={vi.fn()} onClose={close}/>);
  fireEvent.click(screen.getByRole('button',{name:'开始套用'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('connection unavailable');
  expect(screen.getByRole('button',{name:'开始套用'})).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
});
