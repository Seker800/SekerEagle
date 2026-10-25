import { File as NodeFile } from 'node:buffer';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeEditorApp } from './NativeEditorApp';
import type { PhotoEditor } from '../components/media/photo-editor/PhotoEditor';
vi.mock('../components/media/photo-editor/PhotoEditor', () => ({
  PhotoEditor: (props: ComponentProps<typeof PhotoEditor>) => (
    <div>
      <span>
        editor:{props.initialTab}:{props.presentation}:{props.name}
      </span>
      <button
        onClick={() =>
          void props.onSave(new File([new Uint8Array(100000)], 'copy.png'), {
            version: 1,
            edits: DEFAULT_PHOTO_EDITS,
          })
        }
      >
        Save
      </button>
      <button
        onClick={() => void props.onDraftChange?.({ version: 1, edits: DEFAULT_PHOTO_EDITS })}
      >
        Draft
      </button>
      <button onClick={() => void props.onOpenSaved?.('copy')}>View</button>
      <button onClick={props.onClose}>Close</button>
    </div>
  ),
}));
afterEach(() => vi.unstubAllGlobals());
const source = { asset: { displayName: 'photo', originalName: 'photo.jpg' } };
it('offers retry after an interrupted open and starts the shared native editor at watermark', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('读取中断')).mockResolvedValue(source);
  render(<NativeEditorApp request={request} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('读取中断');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('editor:watermark:native:photo')).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});
it('preserves the bounded save protocol, draft, saved-copy navigation and close', async () => {
  vi.stubGlobal('File', NodeFile);
  const request = vi.fn().mockResolvedValue({ asset: { originalName: 'photo.jpg' } });
  render(<NativeEditorApp request={request} />);
  await screen.findByText('editor:watermark:native:photo.jpg');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('save'));
  expect(request).toHaveBeenCalledWith('begin', {
    name: 'copy.png',
    size: 100000,
    recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
  });
  expect(
    request.mock.calls
      .filter(([action]) => action === 'chunk')
      .map(([, payload]) => payload.offset),
  ).toEqual([0, 49152, 98304]);
  fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(request).toHaveBeenCalledWith('draft', {
    recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
  });
  expect(request).toHaveBeenCalledWith('showSaved');
  expect(request).toHaveBeenCalledWith('close');
});
it('ignores a late open after unmount and offers close while loading', async () => {
  let complete!: (value: typeof source) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise<typeof source>((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(<NativeEditorApp request={request} />);
  expect(screen.getByRole('status')).toHaveTextContent('正在读取照片');
  view.unmount();
  await act(async () => complete(source));
  expect(screen.queryByText(/editor:/)).not.toBeInTheDocument();
});
it('shows a useful fallback for an unknown loading failure and lets the user close', async () => {
  const request = vi.fn().mockRejectedValueOnce('unknown').mockResolvedValue(undefined);
  render(<NativeEditorApp request={request} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取原文件');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(request).toHaveBeenCalledWith('close');
});
