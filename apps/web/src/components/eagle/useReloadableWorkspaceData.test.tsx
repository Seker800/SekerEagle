import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReloadableWorkspaceData } from './useReloadableWorkspaceData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('useReloadableWorkspaceData', () => {
  it('shares reads, lets a mutation supersede them, and discards stale completions', async () => {
    const older = deferred<number>(),
      newer = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const apply = vi.fn(),
      onError = vi.fn();
    const { result } = renderHook(() => useReloadableWorkspaceData(load, apply, onError));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    const shared = result.current();
    expect(result.current()).toBe(shared);
    const fresh = result.current(true);
    await act(async () => {
      newer.resolve(2);
      await fresh;
    });
    await act(async () => {
      older.resolve(1);
      await shared;
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith(2);
    expect(onError).not.toHaveBeenCalled();
    await act(async () => {
      await result.current();
    });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('ignores replaced queries and unmounted errors and can recover from a current error', async () => {
    const older = deferred<number>(),
      newer = deferred<number>();
    const firstLoad = () => older.promise;
    const failure = new Error('read failed');
    const secondLoad = vi.fn().mockRejectedValueOnce(failure).mockReturnValue(newer.promise);
    const apply = vi.fn(),
      onError = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ load }) => useReloadableWorkspaceData(load, apply, onError),
      { initialProps: { load: firstLoad } },
    );
    rerender({ load: secondLoad });
    await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(failure));
    await act(async () => {
      older.resolve(1);
      await older.promise;
    });
    expect(apply).not.toHaveBeenCalled();
    const pending = result.current();
    unmount();
    await act(async () => {
      newer.reject(new Error('late'));
      await pending;
    });
    expect(onError).toHaveBeenCalledOnce();
    await result.current();
    expect(secondLoad).toHaveBeenCalledTimes(2);
  });
});
