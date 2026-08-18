import { render, screen } from '@testing-library/react';
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

describe('EagleAssetLightbox', () => {
  it('renders video in a stage-constrained player', () => {
    render(<EagleAssetLightbox asset={videoAsset} onClose={vi.fn()} />);

    const video = screen.getByLabelText('播放 Portrait video');
    expect(video).toHaveAttribute('src', '/api/eagle/assets/video-1/original');
    expect(video.className).toContain('videoPlayer');
  });
});
