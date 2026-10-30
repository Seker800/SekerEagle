import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEagleAssetViewport } from './eagle-asset-viewport';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }
}

function Harness({
  scope = 'all',
  positions,
}: {
  scope?: string;
  positions?: Map<string, number>;
}) {
  const [visible, setVisible] = useState(true);
  const viewport = useEagleAssetViewport(scope, positions);
  return (
    <>
      <button type="button" onClick={() => setVisible((current) => !current)}>
        切换页面
      </button>
      <output aria-label="虚拟滚动位置">{viewport.scrollTop}</output>
      {visible ? (
        <div
          ref={viewport.containerRef}
          role="region"
          aria-label="素材瀑布流"
          onScroll={(event) => viewport.handleScroll(event.currentTarget.scrollTop)}
        />
      ) : null}
    </>
  );
}

describe('useEagleAssetViewport', () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restores virtual and physical scroll position after tag navigation', () => {
    render(<Harness />);
    const firstViewport = screen.getByRole('region', { name: '素材瀑布流' });
    Object.defineProperty(firstViewport, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 2400,
    });
    fireEvent.scroll(firstViewport);
    expect(screen.getByLabelText('虚拟滚动位置')).toHaveTextContent('2400');

    fireEvent.click(screen.getByRole('button', { name: '切换页面' }));
    fireEvent.click(screen.getByRole('button', { name: '切换页面' }));

    expect(screen.getByLabelText('虚拟滚动位置')).toHaveTextContent('2400');
    expect(screen.getByRole('region', { name: '素材瀑布流' }).scrollTop).toBe(2400);
    expect(ResizeObserverMock.instances).toHaveLength(2);
    expect(ResizeObserverMock.instances[0]?.disconnect).toHaveBeenCalled();
  });
  it('restores each query independently and starts new filters at the top', () => {
    const positions = new Map<string, number>();
    const view = render(<Harness scope="all" positions={positions} />);
    const region = screen.getByRole('region', { name: '素材瀑布流' });
    region.scrollTop = 1200;
    fireEvent.scroll(region);
    view.rerender(<Harness scope="search" positions={positions} />);
    expect(region.scrollTop).toBe(0);
    region.scrollTop = 400;
    fireEvent.scroll(region);
    view.rerender(<Harness scope="all" positions={positions} />);
    expect(region.scrollTop).toBe(1200);
    expect(screen.getByLabelText('虚拟滚动位置')).toHaveTextContent('1200');
  });

  it('bounds remembered query positions', () => {
    const positions = new Map<string, number>();
    const view = render(<Harness scope="0" positions={positions} />);
    for (let index = 1; index <= 40; index++)
      view.rerender(<Harness scope={String(index)} positions={positions} />);
    expect(positions.size).toBe(32);
    expect(positions.has('0')).toBe(false);
  });
});
