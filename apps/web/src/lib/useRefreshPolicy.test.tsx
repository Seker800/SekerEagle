import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useProgressQueryInterval } from './useRefreshPolicy';

it('backs off consecutive failures and restarts at five seconds after recovery', () => {
  const hook = renderHook(() => useProgressQueryInterval<number>(() => true, (data) => data));
  const next = (revision: number, failed = false) => hook.result.current({
    state: { data: 1, error: failed ? new Error('offline') : null, errorUpdateCount: revision },
  });
  expect(next(17)).toBe(5000);
  expect(next(18,true)).toBe(5000);
  expect(next(18,true)).toBe(5000);
  expect(next(19,true)).toBe(10000);
  expect(next(19)).toBe(5000);
  expect(next(20,true)).toBe(5000);
});
