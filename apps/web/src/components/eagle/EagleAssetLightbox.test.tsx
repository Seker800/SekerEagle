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
    render(<EagleAssetLightbox asset={videoAsset} onClose={vi.fn()} />);

    const video = screen.getByLabelText('播放 Portrait video');
    expect(video).toHaveAttribute('src', '/api/eagle/assets/video-1/original');
    expect(video.className).toContain('videoPlayer');
  });

  it('provides a real image with an unblocked browser context menu for native copying', () => {
    render(<EagleAssetLightbox asset={imageAsset} purpose="native-copy" onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '复制 Reference image' });
    const image = screen.getByRole('img', { name: 'Reference image' });
    expect(image).toHaveAttribute(
      'src',
      '/api/eagle/assets/image-1/renditions/preview-1/content',
    );
    expect(dialog).toHaveTextContent('在图片上右键，然后选择浏览器的“复制图片”');
    expect(fireEvent.contextMenu(image)).toBe(true);
  });
});
