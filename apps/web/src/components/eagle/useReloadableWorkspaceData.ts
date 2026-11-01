import { useCallback, useEffect, useRef } from 'react';

/** Each query scope owns one in-flight read. Replaced scopes cannot publish stale data. */
export function useReloadableWorkspaceData<T>(
  load: () => Promise<T>,
  apply: (value: T) => void,
  onError: (cause: unknown) => void,
  enabled = true,
) {
  const runner = useRef<(fresh?: boolean) => Promise<void>>(() => Promise.resolve());
  const enabledRef = useRef(enabled);
  const previousEnabled = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    let active = true;
    previousEnabled.current = enabledRef.current;
    let current: Promise<void> | null = null;
    let queued: Promise<void> | null = null;
    let superseded = false;
    const run = (fresh = false): Promise<void> => {
      if (!active || !enabledRef.current) return Promise.resolve();
      if (current) {
        if (!fresh) return current;
        superseded = true;
        queued ??= current.then(() => {
          queued = null;
          return run();
        });
        return queued;
      }
      superseded = false;
      const request = Promise.resolve()
        .then(load)
        .then((value) => {
          if (active && enabledRef.current && !superseded) apply(value);
        })
        .catch((cause: unknown) => {
          if (active && enabledRef.current && !superseded) onError(cause);
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
  useEffect(() => {
    if (enabled && !previousEnabled.current) void runner.current(true);
    previousEnabled.current = enabled;
  }, [enabled]);
  return useCallback((fresh = false) => runner.current(fresh), []);
}
