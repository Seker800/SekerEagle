import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EagleAssetListItem } from '../../lib/eagle-api';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import { EagleAssetThumbnail } from './EagleAssetThumbnail';

const videoAsset: EagleAssetListItem = {
  id: 'video-1',
  originalName: 'clip.mp4',
  displayName: 'Clip',
  mimeType: 'video/mp4',
  format: 'mp4',
  byteSize: 1_024,
  width: 1_920,
  height: 1_080,
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
  renditions: [
    {
      id: 'poster-1',
      kind: 'POSTER',
      revision: 1,
      mimeType: 'image/jpeg',
      byteSize: 512,
      width: 512,
      height: 288,
    },
  ],
  manualTags: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('EagleAssetThumbnail', () => {
  it('starts a muted inline video only after hovering for 500ms and stops on leave', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <EagleAssetThumbnail
        asset={videoAsset}
        scheduler={new MediaLoadScheduler({ maxConcurrent: 1 })}
        order={0}
        displayWidth={240}
      />,
    );
    await act(async () => undefined);

    const media = container.firstElementChild!;
    fireEvent.mouseEnter(media);
    act(() => vi.advanceTimersByTime(499));
    expect(container.querySelector('video')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', '/api/eagle/assets/video-1/original');
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('playsinline');

    fireEvent.mouseLeave(media);
    expect(container.querySelector('video')).not.toBeInTheDocument();
  });

  it('cancels delayed playback when the pointer leaves before 500ms', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <EagleAssetThumbnail
        asset={videoAsset}
        scheduler={new MediaLoadScheduler({ maxConcurrent: 1 })}
        order={0}
        displayWidth={240}
      />,
    );
    await act(async () => undefined);

    const media = container.firstElementChild!;
    fireEvent.mouseEnter(media);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.mouseLeave(media);
    act(() => vi.advanceTimersByTime(300));

    expect(container.querySelector('video')).not.toBeInTheDocument();
  });
});
