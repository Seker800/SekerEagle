import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EagleImageCopyButton } from './EagleImageCopyButton';
const { copy } = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock('../../lib/image-clipboard', () => ({ copyImageToClipboard: copy }));

describe('EagleImageCopyButton', () => {
  beforeEach(() => copy.mockReset());
  it('prevents concurrent writes and resets feedback when the photo changes', async () => {
    let complete!: () => void;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<EagleImageCopyButton sourceUrl="first.webp" />);
    const button = screen.getByRole('button', { name: '复制图片' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledTimes(1);
    view.rerender(<EagleImageCopyButton sourceUrl="second.webp" />);
    await act(async () => complete());
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
    copy.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(copy).toHaveBeenLastCalledWith('second.webp');
    expect(await screen.findByRole('status')).toHaveTextContent('已复制');
    view.rerender(<EagleImageCopyButton sourceUrl="third.webp" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('explains clipboard failures and allows retry without closing the viewer', async () => {
    copy
      .mockRejectedValueOnce(new Error('请使用 localhost 或 HTTPS'))
      .mockResolvedValueOnce(undefined);
    render(<EagleImageCopyButton sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请使用 localhost 或 HTTPS');
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已复制');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('handles non Error rejections and discards errors after unmount', async () => {
    copy.mockRejectedValueOnce('denied');
    const view = render(<EagleImageCopyButton sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制图片失败');
    let reject!: (reason: Error) => void;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    view.unmount();
    await act(async () => reject(new Error('denied')));
  });
});
