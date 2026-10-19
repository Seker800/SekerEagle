import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScrollableToolRow } from './ScrollableToolRow';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(width = 200, contentWidth = 600) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(contentWidth);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const select = vi.fn();
  render(
    <ScrollableToolRow className="tools" label="工具">
      <button onClick={select}>选项</button>
    </ScrollableToolRow>,
  );
  const row = screen.getByRole('group', { name: '工具' });
  const scrollBy = vi.fn();
  Object.defineProperty(row, 'scrollBy', { value: scrollBy });
  return { row, scrollBy, select };
}

it('pages overflowing tools in both directions and updates the end controls', () => {
  const { row, scrollBy } = setup();
  const left = screen.getByRole('button', { name: '工具 · 向左滚动' });
  const right = screen.getByRole('button', { name: '工具 · 向右滚动' });
  expect(left).toBeDisabled();
  fireEvent.click(right);
  expect(scrollBy).toHaveBeenCalledWith({ left: 160, behavior: 'smooth' });
  row.scrollLeft = 400;
  fireEvent.scroll(row);
  expect(right).toBeDisabled();
  expect(left).toBeEnabled();
  fireEvent.keyDown(row, { key: 'ArrowLeft' });
  expect(scrollBy).toHaveBeenLastCalledWith({ left: -160, behavior: 'smooth' });
});

it('maps a mouse wheel to horizontal movement but releases it at the end and preserves zoom', () => {
  const { row } = setup();
  expect(fireEvent.wheel(row, { deltaY: 100, cancelable: true })).toBe(false);
  expect(row.scrollLeft).toBe(100);
  expect(fireEvent.wheel(row, { deltaY: 100, ctrlKey: true, cancelable: true })).toBe(true);
  expect(row.scrollLeft).toBe(100);
  row.scrollLeft = 400;
  expect(fireEvent.wheel(row, { deltaY: 100, cancelable: true })).toBe(true);
});

it('hides unnecessary navigation when every tool fits', () => {
  setup(600, 200);
  expect(screen.queryByRole('button', { name: '工具 · 向右滚动' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '选项' })).toBeEnabled();
});
