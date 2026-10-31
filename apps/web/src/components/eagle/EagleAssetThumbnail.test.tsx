import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EagleAssetListItem } from '../../lib/eagle-api';
import { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import {
  CachedEagleAssetThumbnail,
  EagleAssetThumbnail,
  getEagleAssetThumbnailUrls,
} from './EagleAssetThumbnail';

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

  it('labels video thumbnails without marking image thumbnails as video', () => {
    render(
      <>
        <EagleAssetThumbnail
          asset={videoAsset}
          scheduler={new MediaLoadScheduler({ maxConcurrent: 1 })}
          order={0}
          displayWidth={240}
        />
        <EagleAssetThumbnail
          asset={imageAsset}
          scheduler={new MediaLoadScheduler({ maxConcurrent: 1 })}
          order={1}
          displayWidth={240}
        />
      </>,
    );

    expect(screen.getByLabelText('视频素材')).toHaveTextContent('视频');
    expect(screen.getAllByText('视频')).toHaveLength(1);
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

it('shows a previously loaded thumbnail immediately even while cold images occupy the scheduler', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(new Blob(['image']), { headers: { 'content-type': 'image/webp' } }),
    );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:warm', revokeObjectURL: vi.fn() });
  const service = new ThumbnailLoadService();
  const source = getEagleAssetThumbnailUrls(imageAsset, 240)[0]!;
  const warm = await service.load(
    `${imageAsset.id}:${imageAsset.mediaRevision}:${source}`,
    source,
    new AbortController().signal,
  );
  warm.release();
  const scheduler = new MediaLoadScheduler({ maxConcurrent: 1 });
  let finish!: () => void;
  scheduler.enqueue({
    id: 'cold-image',
    priority: 'visible',
    order: 1,
    run: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  await act(async () => undefined);
  const view = render(
    <EagleAssetThumbnail
      asset={imageAsset}
      scheduler={scheduler}
      loadService={service}
      order={0}
      displayWidth={240}
    />,
  );
  try {
    expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:warm');
    expect(view.queryByLabelText('正在加载缩略图')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    finish();
    service.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('viewer placeholders acquire only a cached current-version blob and release it on close', async () => {
  const service = new ThumbnailLoadService();
  const release = vi.fn();
  const acquire = vi
    .spyOn(service, 'acquireCached')
    .mockReturnValue({ url: 'blob:viewer-thumb', release });
  const load = vi.spyOn(service, 'load');
  const view = render(
    <CachedEagleAssetThumbnail asset={imageAsset} loadService={service} displayWidth={240} />,
  );
  expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:viewer-thumb');
  expect(acquire).toHaveBeenCalledWith(expect.stringContaining('image-1:1:'));
  expect(load).not.toHaveBeenCalled();
  acquire.mockReturnValue(null);
  view.rerender(
    <CachedEagleAssetThumbnail
      asset={{ ...imageAsset, mediaRevision: 2 }}
      loadService={service}
      displayWidth={240}
    />,
  );
  expect(view.container.querySelector('img')).toBeNull();
  expect(release).toHaveBeenCalledOnce();
  view.unmount();
  vi.restoreAllMocks();
});


it('renders the same asset in multiple review groups without replacing or cancelling another view', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new Blob(['image']), { headers: { 'content-type': 'image/webp' } }),
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:shared-review', revokeObjectURL: vi.fn() });
  const service = new ThumbnailLoadService();
  const scheduler = new MediaLoadScheduler({ maxConcurrent: 2 });
  const show = (includeFirst: boolean) => <>
    {includeFirst && <EagleAssetThumbnail key="exact-group" asset={imageAsset} scheduler={scheduler} loadService={service} order={0} displayWidth={240} />}
    <EagleAssetThumbnail key="similar-group" asset={imageAsset} scheduler={scheduler} loadService={service} order={1} displayWidth={240} />
  </>;
  const view = render(show(true));
  try {
    await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.container.querySelectorAll('img').forEach(img => fireEvent.load(img));
    view.rerender(show(false));
    expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:shared-review');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    service.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
