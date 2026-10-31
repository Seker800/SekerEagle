import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number, resetKey = 0): T {
  const [snapshot, setSnapshot] = useState({ value, resetKey });
  // A navigation/reset is an explicit command, not another edit to debounce.
  const reset = snapshot.resetKey !== resetKey;
  if (reset) setSnapshot({ value, resetKey });

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setSnapshot({ value, resetKey }),
      Math.max(0, delayMs),
    );
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value, resetKey]);

  return reset ? value : snapshot.value;
}
