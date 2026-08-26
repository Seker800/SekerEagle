import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EagleAssetListItem } from '../../lib/eagle-api';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import { EagleAssetThumbnail, getEagleAssetThumbnailUrls } from './EagleAssetThumbnail';

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

const imageAsset: EagleAssetListItem = {
  ...videoAsset,
  id: 'image-1',
  originalName: 'still.webp',
  displayName: 'Still',
  mimeType: 'image/webp',
  format: 'webp',
  durationMs: null,
  renditions: [
    {
      ...videoAsset.renditions[0],
      id: 'thumbnail-1',
      kind: 'THUMBNAIL',
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('EagleAssetThumbnail', () => {
  it('selects one current rendition for the target pixel width', () => {
    const asset = {
      ...imageAsset,
      mediaRevision: 2,
      renditions: [
        { ...imageAsset.renditions[0], id: 'old', revision: 1, width: 256 },
        { ...imageAsset.renditions[0], id: 'small', revision: 2, width: 256 },
        { ...imageAsset.renditions[0], id: 'large', revision: 2, width: 512 },
      ],
    };

    expect(getEagleAssetThumbnailUrls(asset, 400)).toEqual([
      '/api/eagle/assets/image-1/renditions/large',
    ]);
    expect(getEagleAssetThumbnailUrls(asset, 200)).toEqual([
      '/api/eagle/assets/image-1/renditions/small',
    ]);
  });

  it('retries a stalled thumbnail instead of occupying a scheduler slot forever', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <EagleAssetThumbnail
        asset={imageAsset}
        scheduler={new MediaLoadScheduler({ maxConcurrent: 1 })}
        order={0}
        displayWidth={240}
      />,
    );
    await act(async () => undefined);

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/eagle/assets/image-1/renditions/thumbnail-1',
    );

    await act(async () => {
      vi.advanceTimersByTime(12_000);
      await Promise.resolve();
    });
    expect(container.querySelector('img')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/eagle/assets/image-1/renditions/thumbnail-1',
    );
  });

  it('releases the scheduler so another visible thumbnail can load after a request stalls', async () => {
    vi.useFakeTimers();
    const scheduler = new MediaLoadScheduler({ maxConcurrent: 1 });
    const nextAsset: EagleAssetListItem = {
      ...imageAsset,
      id: 'image-2',
      renditions: [{ ...imageAsset.renditions[0], id: 'thumbnail-2' }],
    };
    const { container } = render(
      <>
        <EagleAssetThumbnail
          asset={imageAsset}
          scheduler={scheduler}
          order={1}
          displayWidth={240}
        />
        <EagleAssetThumbnail asset={nextAsset} scheduler={scheduler} order={0} displayWidth={240} />
      </>,
    );
    await act(async () => undefined);

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/eagle/assets/image-1/renditions/thumbnail-1',
    );

    await act(async () => {
      vi.advanceTimersByTime(12_000);
      await Promise.resolve();
    });

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/eagle/assets/image-2/renditions/thumbnail-2',
    );
  });

  it('keeps loading newly visible thumbnails when masonry order changes after deletion', async () => {
    const scheduler = new MediaLoadScheduler({ maxConcurrent: 1 });
    const nextAsset: EagleAssetListItem = {
      ...imageAsset,
      id: 'image-2',
      renditions: [{ ...imageAsset.renditions[0], id: 'thumbnail-2' }],
    };
    const gallery = (firstOrder: number, includeNext: boolean) => (
      <>
        <EagleAssetThumbnail
          asset={imageAsset}
          scheduler={scheduler}
          order={firstOrder}
          displayWidth={240}
        />
        {includeNext && (
          <EagleAssetThumbnail
            asset={nextAsset}
            scheduler={scheduler}
            order={0}
            displayWidth={240}
          />
        )}
      </>
    );
    const { container, rerender } = render(gallery(1, false));
    await act(async () => undefined);

    fireEvent.load(container.querySelector('img')!);
    await act(async () => undefined);
    rerender(gallery(2, true));
    await act(async () => undefined);

    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.querySelectorAll('img')[1]).toHaveAttribute(
      'src',
      '/api/eagle/assets/image-2/renditions/thumbnail-2',
    );
  });

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
