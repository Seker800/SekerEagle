import { useCallback, useEffect, useRef } from 'react';

/** Each query scope owns one in-flight read. Replaced scopes cannot publish stale data. */
export function useReloadableWorkspaceData<T>(
  load: () => Promise<T>,
  apply: (value: T) => void,
  onError: (cause: unknown) => void,
) {
  const runner = useRef<(fresh?: boolean) => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    let active = true;
    let current: Promise<void> | null = null;
    const run = (fresh = false): Promise<void> => {
      if (!active) return Promise.resolve();
      if (current && !fresh) return current;
      const request = Promise.resolve()
        .then(load)
        .then((value) => {
          if (active && current === request) apply(value);
        })
        .catch((cause: unknown) => {
          if (active && current === request) onError(cause);
        })
        .finally(() => {
          if (current === request) current = null;
        });
      current = request;
      return request;
    };
    runner.current = run;
    void run();
    return () => {
      active = false;
    };
  }, [load, apply, onError]);
  return useCallback((fresh = false) => runner.current(fresh), []);
}
