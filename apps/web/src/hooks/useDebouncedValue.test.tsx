import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('still coalesces edits in the same context', () => {
  const hook = renderHook(({ value, resetKey }) => useDebouncedValue(value, 150, resetKey), {
    initialProps: { value: 'initial', resetKey: 0 },
  });
  hook.rerender({ value: 'edit', resetKey: 0 });
  act(() => vi.advanceTimersByTime(149));
  expect(hook.result.current).toBe('initial');
  act(() => vi.advanceTimersByTime(1));
  expect(hook.result.current).toBe('edit');
});

it('applies an explicit context reset immediately and cancels the previous pending edit', () => {
  const hook = renderHook(({ value, resetKey }) => useDebouncedValue(value, 150, resetKey), {
    initialProps: { value: 'initial', resetKey: 0 },
  });
  hook.rerender({ value: 'pending edit', resetKey: 0 });
  act(() => vi.advanceTimersByTime(100));
  hook.rerender({ value: 'reset', resetKey: 1 });
  expect(hook.result.current).toBe('reset');
  act(() => vi.advanceTimersByTime(50));
  expect(hook.result.current).toBe('reset');
  hook.rerender({ value: 'new edit', resetKey: 1 });
  act(() => vi.advanceTimersByTime(149));
  expect(hook.result.current).toBe('reset');
  act(() => vi.advanceTimersByTime(1));
  expect(hook.result.current).toBe('new edit');
});
