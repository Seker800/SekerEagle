import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EaglePyramidDescriptor } from '../../lib/eagle-api';
import { EagleImageViewer } from './EagleImageViewer';

const {
  applyConstraintsMock,
  destroyMock,
  getCenterMock,
  getZoomMock,
  handlers,
  openMock,
  openSeadragonMock,
  panByMock,
  panToMock,
  pointFromPixelMock,
  zoomByMock,
  zoomToMock,
} = vi.hoisted(() => {
  const hoistedHandlers = new Map<string, (event?: unknown) => void>();
  const hoistedDestroyMock = vi.fn();
  const hoistedOpenMock = vi.fn();
  const hoistedApplyConstraintsMock = vi.fn();
  const hoistedGetCenterMock = vi.fn(() => ({ x: 0.4, y: 0.6 }));
  const hoistedGetZoomMock = vi.fn(() => 2.5);
  const hoistedPanByMock = vi.fn();
  const hoistedPanToMock = vi.fn();
  const hoistedPointFromPixelMock = vi.fn(() => ({ x: 0.3, y: 0.7 }));
  const hoistedZoomByMock = vi.fn();
  const hoistedZoomToMock = vi.fn();
  const hoistedViewer = {
    addHandler: vi.fn((name: string, handler: (event?: unknown) => void) =>
      hoistedHandlers.set(name, handler),
    ),
    destroy: hoistedDestroyMock,
    open: hoistedOpenMock,
    viewport: {
      applyConstraints: hoistedApplyConstraintsMock,
      deltaPointsFromPixels: vi.fn((point: unknown) => point),
      getCenter: hoistedGetCenterMock,
      getZoom: hoistedGetZoomMock,
      panBy: hoistedPanByMock,
      panTo: hoistedPanToMock,
      pointFromPixel: hoistedPointFromPixelMock,
      zoomBy: hoistedZoomByMock,
      zoomTo: hoistedZoomToMock,
    },
    zoomPerScroll: 1.03,
  };
  return {
    applyConstraintsMock: hoistedApplyConstraintsMock,
    destroyMock: hoistedDestroyMock,
    getCenterMock: hoistedGetCenterMock,
    getZoomMock: hoistedGetZoomMock,
    handlers: hoistedHandlers,
    openMock: hoistedOpenMock,
    openSeadragonMock: vi.fn(() => hoistedViewer),
    panByMock: hoistedPanByMock,
    panToMock: hoistedPanToMock,
    pointFromPixelMock: hoistedPointFromPixelMock,
    viewer: hoistedViewer,
    zoomByMock: hoistedZoomByMock,
    zoomToMock: hoistedZoomToMock,
  };
});

vi.mock('openseadragon', () => ({ default: openSeadragonMock }));

const image = {
  src: '/api/eagle/assets/asset-1/renditions/preview-1',
  alt: 'Owl Reference',
  assetId: 'asset-1',
};

const descriptor: EaglePyramidDescriptor = {
  id: 'pyramid-1',
  width: 8_000,
  height: 6_000,
  tileSize: 512,
  overlap: 1,
  format: 'webp',
  maxLevel: 13,
  tileUrlTemplate: '/api/eagle/assets/asset-1/pyramids/pyramid-1/tiles/{level}/{x}/{y}',
};

describe('EagleImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
  });

  it('uses a low-latency navigator viewer for an ordinary preview image', async () => {
    render(<EagleImageViewer image={image} onClose={vi.fn()} />);

    await waitFor(() => expect(openSeadragonMock).toHaveBeenCalledTimes(1));
    expect(openSeadragonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        animationTime: 0.08,
        blendTime: 0,
        constrainDuringPan: false,
        imageLoaderLimit: 4,
        loadDestinationTilesOnAnimation: false,
        maxImageCacheCount: 64,
        minScrollDeltaTime: 0,
        showNavigator: true,
        tileSources: { type: 'image', url: image.src },
        zoomPerScroll: 1.03,
      }),
    );
    expect(screen.getByRole('dialog', { name: image.alt })).toBeInTheDocument();
    expect(screen.getByTestId('eagle-image-viewer')).toBeInTheDocument();
  });

  it('pans and zooms immediately for direct mouse input', async () => {
    render(<EagleImageViewer image={image} onClose={vi.fn()} />);
    await waitFor(() => expect(handlers.has('canvas-scroll')).toBe(true));

    const negatedDelta = { x: -12, y: 7 };
    const dragEvent = {
      delta: { negate: vi.fn(() => negatedDelta) },
      pointerType: 'mouse',
      preventDefaultAction: false,
    };
    act(() => handlers.get('canvas-drag')?.(dragEvent));
    expect(dragEvent.preventDefaultAction).toBe(true);
    expect(panByMock).toHaveBeenCalledWith(negatedDelta, true);

    const scrollEvent = {
      pointerType: 'mouse',
      position: { x: 320, y: 180 },
      scroll: 0.5,
      preventDefaultAction: false,
    };
    act(() => handlers.get('canvas-scroll')?.(scrollEvent));
    expect(scrollEvent.preventDefaultAction).toBe(true);
    expect(pointFromPixelMock).toHaveBeenCalledWith(scrollEvent.position, true);
    expect(zoomByMock).toHaveBeenCalledWith(Math.pow(1.03, 0.5), { x: 0.3, y: 0.7 }, true);

    const dragEndEvent = { pointerType: 'mouse', preventDefaultAction: false };
    act(() => handlers.get('canvas-drag-end')?.(dragEndEvent));
    expect(dragEndEvent.preventDefaultAction).toBe(true);
    expect(applyConstraintsMock).toHaveBeenCalledWith(false);
  });

  it('upgrades to pyramid tiles after interaction settles and preserves the viewport', async () => {
    const view = render(<EagleImageViewer image={image} onClose={vi.fn()} />);
    await waitFor(() => expect(openSeadragonMock).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    view.rerender(<EagleImageViewer image={image} descriptor={descriptor} onClose={vi.fn()} />);
    expect(openMock).not.toHaveBeenCalled();

    act(() => handlers.get('canvas-scroll')?.({
      pointerType: 'mouse',
      position: { x: 200, y: 100 },
      scroll: 0.1,
      preventDefaultAction: false,
    }));
    act(() => vi.advanceTimersByTime(119));
    expect(openMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: descriptor.width,
        height: descriptor.height,
        tileSize: descriptor.tileSize,
      }),
    );
    expect(getCenterMock).toHaveBeenCalledWith(true);
    expect(getZoomMock).toHaveBeenCalledWith(true);

    act(() => handlers.get('open')?.());
    expect(zoomToMock).toHaveBeenCalledWith(2.5, undefined, true);
    expect(panToMock).toHaveBeenCalledWith({ x: 0.4, y: 0.6 }, true);
    expect(applyConstraintsMock).toHaveBeenCalledWith(true);
    expect(openSeadragonMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows a recoverable error when the active image source fails', async () => {
    render(<EagleImageViewer image={image} onClose={vi.fn()} />);
    await waitFor(() => expect(handlers.has('open-failed')).toBe(true));

    act(() => handlers.get('open-failed')?.());
    expect(screen.getByRole('alert')).toHaveTextContent('图片加载失败');

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(openMock).toHaveBeenCalledWith({ type: 'image', url: image.src });
  });
});
