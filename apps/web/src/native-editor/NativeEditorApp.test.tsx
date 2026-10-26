import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeEditorApp } from './NativeEditorApp';
import type { PhotoEditor } from '../components/media/photo-editor/PhotoEditor';
const captured = vi.hoisted(() => ({
  save: undefined as ComponentProps<typeof PhotoEditor>['onSaveRecipe'],
}));
vi.mock('../components/media/photo-editor/PhotoEditor', () => ({
  PhotoEditor: (props: ComponentProps<typeof PhotoEditor>) => {
    captured.save = props.onSaveRecipe;
    return (
      <div>
        <span>{props.saveUnavailable}</span>
        <span>
          editor:{props.initialTab}:{props.presentation}:{props.name}
        </span>
        <button
          disabled={Boolean(props.saveUnavailable)}
          onClick={() =>
            void props.onSaveRecipe?.({
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
    );
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const source = { asset: { displayName: 'photo', originalName: 'photo.jpg' } };
it('offers retry after an interrupted open and starts the shared native editor at watermark', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('读取中断')).mockResolvedValue(source);
  render(<NativeEditorApp request={request} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('读取中断');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('editor:watermark:native:photo')).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});
it('submits only recipe parameters and waits for server publication without sending photo bytes', async () => {
  const request = vi
    .fn()
    .mockImplementation(async (action: string) =>
      action === 'open'
        ? { asset: { originalName: 'photo.jpg' }, serverEditing: true }
        : action === 'saveStatus'
          ? { status: 'COMPLETED', asset: { id: 'copy', name: 'copy.png' } }
          : {},
    );
  render(<NativeEditorApp request={request} />);
  await screen.findByText('editor:watermark:native:photo.jpg');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('saveStatus'));
  expect(request).toHaveBeenCalledWith('saveRecipe', {
    recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
  });
  expect(
    request.mock.calls.some(([action]) => ['begin', 'chunk', 'save'].includes(String(action))),
  ).toBe(false);
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

it('blocks saving with an actionable explanation when an older server has no renderer', async () => {
  const request = vi.fn().mockResolvedValue(source);
  render(<NativeEditorApp request={request} />);
  await screen.findByText('editor:watermark:native:photo');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByText('服务器编辑服务尚未更新，暂时无法保存成片。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(request).toHaveBeenCalledTimes(1);
});

it('returns control after bounded background saving and lets a later save resume the same native intent', async () => {
  const request = vi
    .fn()
    .mockImplementation(async (action: string) =>
      action === 'open'
        ? { ...source, serverEditing: true }
        : action === 'saveStatus'
          ? { status: 'PENDING' }
          : {},
    );
  render(<NativeEditorApp request={request} />);
  await screen.findByText('editor:watermark:native:photo');
  vi.useFakeTimers();
  const recipe = { version: 1 as const, edits: DEFAULT_PHOTO_EDITS };
  const pending = captured.save!(recipe);
  let outcome: unknown;
  void pending.then(
    (value) => {
      outcome = value;
    },
    (reason) => {
      outcome = reason;
    },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000 + 1500);
  });
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toContain('后台');
  request.mockImplementation(async (action: string) =>
    action === 'saveStatus' ? { status: 'COMPLETED', asset: { id: 'copy', name: 'copy.png' } } : {},
  );
  await expect(captured.save!(recipe)).resolves.toEqual({ id: 'copy', name: 'copy.png' });
  expect(request.mock.calls.filter(([action]) => action === 'saveRecipe')).toHaveLength(2);
});
