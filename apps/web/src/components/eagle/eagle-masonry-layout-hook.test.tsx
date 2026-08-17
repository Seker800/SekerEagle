import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEagleMasonryLayout } from './eagle-masonry-layout';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  emitWidth(width: number) {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function LayoutHarness() {
  const [visible, setVisible] = useState(true);
  const { containerRef, layout } = useEagleMasonryLayout([
    { id: 'square', width: 800, height: 800 },
  ]);

  return (
    <>
      <button type="button" onClick={() => setVisible((current) => !current)}>
        切换页面
      </button>
      <output aria-label="瀑布流列数">{layout.columns}</output>
      <output aria-label="瀑布流卡片宽度">{layout.items[0]?.width}</output>
      {visible && <div ref={containerRef} />}
    </>
  );
}

describe('useEagleMasonryLayout', () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes the replacement container after leaving and returning to the asset view', () => {
    render(<LayoutHarness />);
    expect(ResizeObserverMock.instances).toHaveLength(1);

    act(() => ResizeObserverMock.instances[0]?.emitWidth(800));
    expect(screen.getByLabelText('瀑布流列数')).toHaveTextContent('3');

    fireEvent.click(screen.getByRole('button', { name: '切换页面' }));
    expect(ResizeObserverMock.instances[0]?.disconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '切换页面' }));

    expect(ResizeObserverMock.instances).toHaveLength(2);
    act(() => ResizeObserverMock.instances[1]?.emitWidth(450));
    expect(screen.getByLabelText('瀑布流列数')).toHaveTextContent('2');
  });

  it('ignores subpixel ResizeObserver noise inside the same CSS pixel', () => {
    render(<LayoutHarness />);

    act(() => ResizeObserverMock.instances[0]?.emitWidth(800.2));
    const stableWidth = screen.getByLabelText('瀑布流卡片宽度').textContent;
    act(() => ResizeObserverMock.instances[0]?.emitWidth(800.4));

    expect(screen.getByLabelText('瀑布流卡片宽度')).toHaveTextContent(stableWidth ?? '');
  });
});
