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

function pointer(row: HTMLElement, type: string, x: number, buttons = 1, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0, buttons });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  fireEvent(row, event);
}
it('drags the continuous tool strip without accidentally selecting the released thumbnail', () => {
  const { row, select } = setup();
  const capture = vi.fn();
  Object.defineProperty(row, 'setPointerCapture', { value: capture });
  row.scrollLeft = 200;
  pointer(row, 'pointerdown', 100);
  pointer(row, 'pointermove', 103);
  expect(row.scrollLeft).toBe(200);
  pointer(row, 'pointermove', 150);
  expect(row.scrollLeft).toBe(150);
  expect(capture).toHaveBeenCalledWith(1);
  pointer(row, 'pointerup', 150);
  fireEvent.click(screen.getByRole('button', { name: '选项' }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选项' }));
  expect(select).toHaveBeenCalledOnce();
});
it('ends interrupted mouse gestures and leaves touch scrolling to the browser', () => {
  const { row, select } = setup();
  Object.defineProperty(row, 'setPointerCapture', { value: vi.fn() });
  pointer(row, 'pointerdown', 100);
  pointer(row, 'pointermove', 150);
  pointer(row, 'pointercancel', 150);
  fireEvent.click(screen.getByRole('button', { name: '选项' }));
  expect(select).toHaveBeenCalledOnce();
  pointer(row, 'pointerdown', 100);
  pointer(row, 'lostpointercapture', 100);
  pointer(row, 'pointermove', 150);
  const left = row.scrollLeft;
  pointer(row, 'pointerdown', 100);
  pointer(row, 'pointermove', 130, 0);
  pointer(row, 'pointermove', 180);
  expect(row.scrollLeft).toBe(left);
  pointer(row, 'pointerdown', 100, 1, 'touch');
  pointer(row, 'pointermove', 150, 1, 'touch');
  expect(row.scrollLeft).toBe(left);
});

it('reserves trailing space so the final category can align to the start even on a wide viewport', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const left = this.hasAttribute('data-category-start')
      ? 400
      : this.tagName === 'BUTTON'
        ? 600
        : 0;
    return { left, right: left + 100, width: 100 } as DOMRect;
  });
  render(
    <ScrollableToolRow className="tools" label="分类工具" anchorSelector="[data-category-start]">
      <button>第一组</button>
      <button data-category-start>末组</button>
      <button>末组第二项</button>
    </ScrollableToolRow>,
  );
  const row = screen.getByRole('group', { name: '分类工具' });
  expect(row.lastElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(row.lastElementChild).toHaveStyle({ flexBasis: '600px' });
});
