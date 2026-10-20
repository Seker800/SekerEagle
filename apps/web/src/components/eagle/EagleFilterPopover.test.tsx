import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { EagleFilterPopover } from './EagleFilterPopover';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps a tall popover below its trigger without borrowing space from above and responds to the keyboard viewport', () => {
  const viewport = Object.assign(new EventTarget(), {
    width: 320,
    height: 900,
    offsetLeft: 0,
    offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    width: 310,
    height: 500,
    bottom: 500,
    right: 310,
  } as DOMRect);
  const anchor = createRef<HTMLElement>();
  const panel = createRef<HTMLDivElement>();
  render(
    <>
      <button
        ref={(element) => {
          anchor.current = element;
          if (element)
            element.getBoundingClientRect = () =>
              ({ top: 500, bottom: 544, left: 280, right: 324, width: 44, height: 44 }) as DOMRect;
        }}
      >
        trigger
      </button>
      <EagleFilterPopover anchor={anchor} panelRef={panel} onClose={() => {}}>
        <div role="dialog">content</div>
      </EagleFilterPopover>
    </>,
  );
  const floating = screen.getByRole('dialog').parentElement!;
  expect(parseFloat(floating.style.top)).toBeGreaterThanOrEqual(544);
  expect(parseFloat(floating.style.top) + parseFloat(floating.style.maxHeight)).toBeLessThanOrEqual(
    892,
  );
  expect(parseFloat(floating.style.left) + parseFloat(floating.style.width)).toBeLessThanOrEqual(
    312,
  );
  viewport.height = 400;
  act(() => {
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(parseFloat(floating.style.top) + parseFloat(floating.style.maxHeight)).toBeLessThanOrEqual(
    392,
  );
});
