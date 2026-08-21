import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

function Harness() {
  const [visible, setVisible] = useState(true);
  const viewport = useEagleAssetViewport();
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

  it('resets stale virtual scroll state and observes the replacement viewport after tag navigation', () => {
    render(<Harness />);
    const firstViewport = screen.getByRole('region', { name: '素材瀑布流' });
    Object.defineProperty(firstViewport, 'scrollTop', { configurable: true, value: 2400 });
    fireEvent.scroll(firstViewport);
    expect(screen.getByLabelText('虚拟滚动位置')).toHaveTextContent('2400');

    fireEvent.click(screen.getByRole('button', { name: '切换页面' }));
    fireEvent.click(screen.getByRole('button', { name: '切换页面' }));

    expect(screen.getByLabelText('虚拟滚动位置')).toHaveTextContent('0');
    expect(ResizeObserverMock.instances).toHaveLength(2);
    expect(ResizeObserverMock.instances[0]?.disconnect).toHaveBeenCalled();
  });
});
