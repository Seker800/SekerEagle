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

describe('EagleAssetLightbox', () => {
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

    const dialog = screen.getByRole('dialog', { name: '素材大图预览' });
    const image = screen.getByRole('img', { name: 'Reference image' });
    expect(image).toHaveAttribute('src', '/api/eagle/assets/image-1/renditions/preview-1');
    expect(dialog).toHaveTextContent('Esc 关闭');

    fireEvent.click(image);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(image.parentElement!);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '关闭大图预览' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
