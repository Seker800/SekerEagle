import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type EagleAssetListItem } from '../../lib/eagle-api';
import { EagleAssetLightbox } from './EagleAssetLightbox';

const videoAsset: EagleAssetListItem = {
  id: 'video-1',
  originalName: 'portrait.mp4',
  displayName: 'Portrait video',
  mimeType: 'video/mp4',
  format: 'mp4',
  byteSize: 1_024,
  width: 1_080,
  height: 1_920,
  durationMs: 10_000,
  lifecycleStatus: 'READY',
  mediaErrorCode: null,
  mediaRevision: 1,
  rowVersion: 1,
  rating: null,
  libraryAddedAt: '2026-08-17T00:00:00.000Z',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  deletedAt: null,
  renditions: [],
  manualTags: [],
};

const imageAsset: EagleAssetListItem = {
  ...videoAsset,
  id: 'image-1',
  originalName: 'reference.png',
  displayName: 'Reference image',
  mimeType: 'image/png',
  format: 'png',
  durationMs: null,
  renditions: [
    {
      id: 'preview-1',
      kind: 'PREVIEW',
      revision: 1,
      mimeType: 'image/webp',
      byteSize: 512,
      width: 1_080,
      height: 1_920,
    },
  ],
};

const { copyImageMock } = vi.hoisted(() => ({ copyImageMock: vi.fn() }));
vi.mock('openseadragon', () => ({ default: () => ({ addHandler() {}, destroy() {}, open() {} }) }));
vi.mock('../../lib/image-clipboard', () => ({ copyImageToClipboard: copyImageMock }));

describe('EagleAssetLightbox', () => {
  it('copies the current photo preview and keeps native image context menus', () => {
    copyImageMock.mockResolvedValue(undefined);
    const view = render(<EagleAssetLightbox asset={imageAsset} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(copyImageMock).toHaveBeenLastCalledWith(
      '/api/eagle/assets/image-1/renditions/preview-1',
    );
    expect(fireEvent.contextMenu(screen.getByTestId('eagle-image-viewer'))).toBe(true);
    view.rerender(
      <EagleAssetLightbox asset={{ ...imageAsset, id: 'image-2' }} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(copyImageMock).toHaveBeenLastCalledWith(
      '/api/eagle/assets/image-2/renditions/preview-1',
    );
    view.rerender(<EagleAssetLightbox asset={videoAsset} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '复制图片' })).not.toBeInTheDocument();
  });

  it('renders video in a stage-constrained player', () => {
    const onClose = vi.fn();
    render(<EagleAssetLightbox asset={videoAsset} onClose={onClose} />);

    const video = screen.getByLabelText('播放 Portrait video');
    expect(video).toHaveAttribute('src', '/api/eagle/assets/video-1/original');
    expect(video.className).toContain('videoPlayer');
    fireEvent.click(video);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders an image in the standard asset preview', () => {
    const onClose = vi.fn();
    render(<EagleAssetLightbox asset={imageAsset} onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'Reference image' });
    const image = screen.getByTestId('eagle-image-viewer');
    expect(dialog).toHaveTextContent('PNG · 1080 × 1920');

    fireEvent.click(image);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

it('supports keyboard and button navigation without closing a photo stack', () => {
  const onNext = vi.fn(),
    onPrevious = vi.fn(),
    onClose = vi.fn();
  render(
    <EagleAssetLightbox
      asset={imageAsset}
      onClose={onClose}
      navigation={{ index: 0, count: 2, onNext, onPrevious }}
    />,
  );
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onPrevious).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(onNext).toHaveBeenCalledTimes(2);
  expect(onClose).not.toHaveBeenCalled();
});

it('plays the current transcoded camera video instead of decoding the camera original', () => {
  render(
    <EagleAssetLightbox
      asset={{
        ...videoAsset,
        mimeType: 'application/mxf',
        format: 'mxf',
        renditions: [
          {
            id: 'playback',
            kind: 'PREVIEW',
            revision: 1,
            mimeType: 'video/mp4',
            byteSize: 100,
            width: 1920,
            height: 1080,
          },
        ],
      }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('播放 Portrait video')).toHaveAttribute(
    'src',
    '/api/eagle/assets/video-1/renditions/playback',
  );
});
it('does not fall back to a MOV original when its playback copy is not ready', () => {
  render(
    <EagleAssetLightbox
      asset={{ ...videoAsset, mimeType: 'video/quicktime', format: 'mov', renditions: [] }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText('播放 Portrait video')).not.toBeInTheDocument();
});

it('edits the displayed group member rather than a cover or neighboring photo', () => {
  const onEdit = vi.fn();
  const view = render(
    <EagleAssetLightbox
      asset={imageAsset}
      onEdit={onEdit}
      onClose={vi.fn()}
      navigation={{ index: 1, count: 3, onPrevious: vi.fn(), onNext: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑照片' }));
  expect(onEdit).toHaveBeenCalledWith(imageAsset);
  view.rerender(
    <EagleAssetLightbox asset={imageAsset} loading onEdit={onEdit} onClose={vi.fn()} />,
  );
  expect(screen.queryByRole('button', { name: '编辑照片' })).toBeNull();
});

it('distinguishes a failed playback job from a deferred copy while retaining the poster', () => {
  const asset = {
    ...videoAsset,
    id: 'video',
    mimeType: 'video/quicktime',
    displayName: 'video.mov',
    mediaRevision: 1,
    renditions: [
      { id: 'poster', kind: 'THUMBNAIL', variant: 'poster', revision: 1, mimeType: 'image/jpeg' },
    ],
    mediaErrorCode: 'VIDEO_PLAYBACK_FAILED',
  } as EagleAssetListItem;
  const view = render(<EagleAssetLightbox asset={asset} onClose={() => {}} />);
  expect(screen.getByText('视频播放副本生成失败，原片已保存，可在处理任务中重试')).toBeVisible();
  expect(screen.getByRole('img', { name: 'video.mov' })).toBeVisible();
  view.rerender(
    <EagleAssetLightbox asset={{ ...asset, mediaErrorCode: null }} onClose={() => {}} />,
  );
  expect(screen.getByText('视频播放副本尚未生成，原片已保存')).toBeVisible();
});
