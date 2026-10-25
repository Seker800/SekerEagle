import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NativeEditorApp } from './NativeEditorApp';
vi.mock('../components/media/photo-editor/PhotoEditor', () => ({
  PhotoEditor: ({ initialTab }: { initialTab: string }) => <div>editor:{initialTab}</div>,
}));
it('offers retry after an interrupted open and starts the shared editor at watermark', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('读取中断')).mockResolvedValue({ asset: { displayName: 'photo', originalName: 'photo.jpg' } });
  render(<NativeEditorApp request={request} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('读取中断');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('editor:watermark')).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});
