import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EaglePyramidDescriptor } from '../../lib/eagle-api';
import { EagleImageViewer } from './EagleImageViewer';

const destroyMock = vi.fn();
const openMock = vi.fn();
const handlers = new Map<string, (event?: unknown) => void>();
const viewer = {
  addHandler: vi.fn((name: string, handler: (event?: unknown) => void) => handlers.set(name, handler)),
  destroy: destroyMock,
  open: openMock,
};
const openSeadragonMock = vi.fn(() => viewer);

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

  it('uses the smooth navigator viewer for an ordinary preview image', async () => {
    render(<EagleImageViewer image={image} onClose={vi.fn()} />);

    await waitFor(() => expect(openSeadragonMock).toHaveBeenCalledTimes(1));
    expect(openSeadragonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        animationTime: 0.3,
        imageLoaderLimit: 4,
        maxImageCacheCount: 64,
        showNavigator: true,
        tileSources: { type: 'image', url: image.src },
      }),
    );
    expect(screen.getByRole('dialog', { name: image.alt })).toBeInTheDocument();
    expect(screen.getByTestId('eagle-image-viewer')).toBeInTheDocument();
  });

  it('upgrades the stable viewer to pyramid tiles without remounting it', async () => {
    const view = render(<EagleImageViewer image={image} onClose={vi.fn()} />);
    await waitFor(() => expect(openSeadragonMock).toHaveBeenCalledTimes(1));

    view.rerender(<EagleImageViewer image={image} descriptor={descriptor} onClose={vi.fn()} />);

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: descriptor.width,
        height: descriptor.height,
        tileSize: descriptor.tileSize,
      }),
    );
    expect(openSeadragonMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).not.toHaveBeenCalled();
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
