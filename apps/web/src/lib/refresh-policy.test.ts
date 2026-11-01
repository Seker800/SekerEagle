import { describe, expect, it } from 'vitest';
import { createProgressRefreshSchedule, retryRefreshDelay } from './refresh-policy';

describe('shared refresh policy', () => {
  it('observes running work at five seconds, backs off only while unchanged, then stops', () => {
    const next = createProgressRefreshSchedule();
    expect(next({ visible: true, active: true, signature: '1', now: 0 })).toBe(5000);
    expect(next({ visible: true, active: true, signature: '1', now: 30_000 })).toBe(10000);
    expect(next({ visible: true, active: true, signature: '2', now: 31_000 })).toBe(5000);
    expect(next({ visible: true, active: false, signature: 'done', now: 32_000 })).toBe(false);
    expect(next({ visible: true, active: false, signature: 'done', now: 60_000 })).toBe(false);
  });
  it('does not schedule display requests in a hidden window', () => {
    expect(
      createProgressRefreshSchedule()({ visible: false, active: true, signature: '1', now: 0 }),
    ).toBe(false);
  });
  it('backs off errors without hiding terminal authentication failures', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => retryRefreshDelay(n))).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000,
    ]);
    const next = createProgressRefreshSchedule();
    expect(next({ visible: true, active: true, signature: '1', now: 0, failures: 2 })).toBe(10000);
    expect(
      next({ visible: true, active: true, signature: '1', now: 0, failures: 2, status: 401 }),
    ).toBe(false);
    expect(
      next({ visible: true, active: true, signature: '1', now: 0, failures: 2, status: 403 }),
    ).toBe(false);
  });
});
