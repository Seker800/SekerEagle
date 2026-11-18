import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { EagleImageCopyButton } from './EagleImageCopyButton';
const { copy, copyShare } = vi.hoisted(() => ({ copy: vi.fn(), copyShare: vi.fn() }));
vi.mock('../../lib/image-clipboard', () => ({
  copyImageToClipboard: copy,
  copyShareImageToClipboard: copyShare,
}));

const imageAsset = {
  id: 'asset-1',
  mimeType: 'image/jpeg',
  libraryMode: 'MATERIAL',
  width: 8_000,
  height: 6_000,
} as unknown as EagleAssetListItem;
const smallImageAsset = {
  ...imageAsset,
  id: 'asset-2',
  width: 1_600,
  height: 1_200,
} as EagleAssetListItem;

describe('EagleImageCopyButton', () => {
  beforeEach(() => {
    copy.mockReset();
    copyShare.mockReset();
  });
  it('copies the 4K share rendition when the viewer knows the asset', async () => {
    copyShare.mockResolvedValue(undefined);
    render(<EagleImageCopyButton asset={imageAsset} sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(copyShare).toHaveBeenCalledWith('/api/eagle/assets/asset-1/share-image');
    expect(copy).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('已复制 4K 分享图');
    expect(screen.getByRole('button', { name: '复制到剪贴板' })).toHaveAttribute(
      'title',
      '复制为分享图：JPEG，长边最多 4096 像素；小图按原尺寸，透明区域变白底。',
    );
  });
  it('does not claim 4K when the copied share version is smaller', async () => {
    copyShare.mockResolvedValue(undefined);
    render(<EagleImageCopyButton asset={smallImageAsset} sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/^已复制分享图$/);
  });
  it('prevents concurrent writes and resets feedback when the photo changes', async () => {
    let complete!: () => void;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<EagleImageCopyButton sourceUrl="first.webp" />);
    const button = screen.getByRole('button', { name: '复制到剪贴板' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledTimes(1);
    view.rerender(<EagleImageCopyButton sourceUrl="second.webp" />);
    await act(async () => complete());
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
    copy.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
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
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请使用 localhost 或 HTTPS');
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已复制');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('handles non Error rejections and discards errors after unmount', async () => {
    copy.mockRejectedValueOnce('denied');
    const view = render(<EagleImageCopyButton sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制到剪贴板失败');
    let reject!: (reason: Error) => void;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    view.unmount();
    await act(async () => reject(new Error('denied')));
  });
});
