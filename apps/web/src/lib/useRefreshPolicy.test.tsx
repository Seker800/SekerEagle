import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useProgressQueryInterval } from './useRefreshPolicy';

it('backs off consecutive failures and restarts at five seconds after recovery', () => {
  const hook = renderHook(() =>
    useProgressQueryInterval<number>(
      () => true,
      (data) => data,
    ),
  );
  const next = (revision: number, failed = false) =>
    hook.result.current({
      state: { data: 1, error: failed ? new Error('offline') : null, errorUpdateCount: revision },
    });
  expect(next(17)).toBe(5000);
  expect(next(18, true)).toBe(5000);
  expect(next(18, true)).toBe(5000);
  expect(next(19, true)).toBe(10000);
  expect(next(19)).toBe(5000);
  expect(next(20, true)).toBe(5000);
});

it('wakes once at a known scheduling boundary without idle progress reads', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(0);
    const hook = renderHook(() =>
      useProgressQueryInterval<number>(
        () => false,
        (value) => value,
        () => new Date(60_000),
      ),
    );
    const query = { state: { data: 1, error: null, errorUpdateCount: 0 } };
    expect(hook.result.current(query)).toBe(60_000);
    vi.setSystemTime(60_000);
    expect(hook.result.current(query)).toBe(5000);
    hook.unmount();
  } finally {
    vi.useRealTimers();
  }
});
