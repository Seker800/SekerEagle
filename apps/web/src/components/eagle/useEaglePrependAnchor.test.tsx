import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEaglePrependAnchor } from './useEaglePrependAnchor';
it('preserves the visible card and user movement when newer rows are prepended', () => {
  const element = { scrollTop: 40, scrollTo: vi.fn() };
  const viewport = { elementRef: { current: element }, handleScroll: vi.fn() };
  const items = [
    { id: 'a', top: 30, height: 100 },
    { id: 'b', top: 140, height: 100 },
  ];
  const { result, rerender } = renderHook(
    ({ items, scope }) => useEaglePrependAnchor(items, viewport as never, scope),
    { initialProps: { items, scope: 'photo:month-a' } },
  );
  act(() => result.current.capture());
  element.scrollTop = 70;
  rerender({
    items: [
      { id: 'new', top: 30, height: 100 },
      { id: 'a', top: 250, height: 100 },
      { id: 'b', top: 360, height: 100 },
    ],
    scope: 'photo:month-a',
  });
  expect(element.scrollTo).toHaveBeenCalledWith({ top: 290, behavior: 'instant' });
  expect(viewport.handleScroll).toHaveBeenCalledWith(290);
  element.scrollTo.mockClear();
  act(() => result.current.capture());
  rerender({ items: [{ id: 'other', top: 0, height: 100 }], scope: 'photo:month-b' });
  expect(element.scrollTo).not.toHaveBeenCalled();
});
it('does not move the viewport for append-only updates or a vanished anchor', () => {
  const element = { scrollTop: 0, scrollTo: vi.fn() };
  const viewport = { elementRef: { current: element }, handleScroll: vi.fn() };
  const items = [{ id: 'a', top: 0, height: 100 }];
  const { result, rerender } = renderHook(
    ({ items }) => useEaglePrependAnchor(items, viewport as never, 'scope'),
    { initialProps: { items } },
  );
  act(() => result.current.capture());
  rerender({ items: [...items, { id: 'b', top: 100, height: 100 }] });
  expect(element.scrollTo).not.toHaveBeenCalled();
  act(() => result.current.capture());
  rerender({ items: [{ id: 'c', top: 0, height: 100 }] });
  expect(element.scrollTo).not.toHaveBeenCalled();
});

it('retains the pending anchor through an intermediate entity or append render', () => {
  const element = { scrollTop: 20, scrollTo: vi.fn() };
  const viewport = { elementRef: { current: element }, handleScroll: vi.fn() };
  const items = [{ id: 'a', top: 0, height: 100 }];
  const { result, rerender } = renderHook(
    ({ items }) => useEaglePrependAnchor(items, viewport as never, 'scope'),
    { initialProps: { items } },
  );
  act(() => result.current.capture());
  rerender({ items: [...items, { id: 'b', top: 100, height: 100 }] });
  rerender({
    items: [
      { id: 'new', top: 0, height: 100 },
      { id: 'a', top: 100, height: 100 },
    ],
  });
  expect(element.scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'instant' });
});

it('keeps a surviving visible card anchored when deletion occurs in the middle of loaded pages', () => {
  const element = { scrollTop: 170, scrollTo: vi.fn() };
  const viewport = { elementRef: { current: element }, handleScroll: vi.fn() };
  const items = [
    { id: 'a', top: 0, height: 80 },
    { id: 'delete', top: 80, height: 80 },
    { id: 'visible', top: 160, height: 80 },
  ];
  const { result, rerender } = renderHook(
    ({ items }) => useEaglePrependAnchor(items, viewport as never, 'scope'),
    { initialProps: { items } },
  );
  act(() => result.current.capture());
  rerender({ items: [items[0]!, { id: 'visible', top: 80, height: 80 }] });
  expect(element.scrollTo).toHaveBeenCalledWith({ top: 90, behavior: 'instant' });
});
