import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceChangeKind } from '@sekereagle/library-core';
import { createProgressRefreshSchedule, scheduledRefreshDelay } from './refresh-policy';
import { ApiError } from './api-error';
import { useLibraryWorkspace } from './library-workspace';
import { workspaceRefreshKey, type WorkspaceRefreshObservation } from './workspace-refresh';

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};
export const usePageVisible = () =>
  useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );

export function useProgressQueryInterval<T>(
  active: (data: T) => boolean,
  signature: (data: T) => unknown,
  nextWake?: (data: T) => Date | null,
) {
  const visible = usePageVisible();
  const schedule = useMemo(createProgressRefreshSchedule, []);
  const errors = useRef({ revision: 0, consecutive: 0 });
  return (query: { state: { data?: T; error: Error | null; errorUpdateCount: number } }) => {
    if (!query.state.error) errors.current.consecutive = 0;
    else if (errors.current.revision !== query.state.errorUpdateCount) errors.current.consecutive++;
    errors.current.revision = query.state.errorUpdateCount;
    const delay = schedule({
      visible,
      active: query.state.data !== undefined && active(query.state.data),
      signature: JSON.stringify(
        query.state.data === undefined ? null : signature(query.state.data),
      ),
      failures: query.state.error ? errors.current.consecutive : 0,
      status: query.state.error instanceof ApiError ? query.state.error.status : undefined,
    });
    if (delay !== false || !visible || query.state.error || query.state.data === undefined)
      return delay;
    return scheduledRefreshDelay(nextWake?.(query.state.data)?.getTime());
  };
}

/** For existing local-state views; query-backed views are invalidated centrally. */
export function useRefreshOnWorkspaceChanges(
  reload: (fresh?: boolean) => Promise<void>,
  kinds: readonly WorkspaceChangeKind[],
  enabled = true,
) {
  const { ownerId, libraryMode, includePrivate } = useLibraryWorkspace();
  const client = useQueryClient();
  const visible = usePageVisible();
  const subscribe = (listener: () => void) => client.getQueryCache().subscribe(listener);
  const read = () => {
    const value = client.getQueryData<WorkspaceRefreshObservation>(
      workspaceRefreshKey(ownerId, includePrivate),
    );
    return value?.snapshot
      ? JSON.stringify([
          value.snapshot.epoch,
          ...kinds.map((kind) => value.snapshot!.scopes[libraryMode][kind]),
          kinds.includes('TASKS') ? value.snapshot.health : null,
        ])
      : '';
  };
  const revision = useSyncExternalStore(subscribe, read, () => '');
  const applied = useRef(revision);
  useEffect(() => {
    if (!enabled || !visible || revision === applied.current) return;
    applied.current = revision;
    void reload(true);
  }, [enabled, reload, revision, visible]);
}

export function useActivityRefresh(
  reload: () => Promise<void>,
  active: boolean,
  signature: unknown,
  enabled = true,
  failure?: { count: number; error: unknown },
  nextAt?: Date | null,
) {
  const visible = usePageVisible();
  const schedule = useMemo(createProgressRefreshSchedule, []);
  const encoded = JSON.stringify(signature);
  const failures = failure?.count ?? 0;
  const status = failure?.error instanceof ApiError ? failure.error.status : undefined;
  const wakeAt = nextAt?.getTime();
  useEffect(() => {
    if (!enabled || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const queue = () => {
      const progress = schedule({ visible: true, active, signature: encoded, failures, status });
      const delay = progress === false && !failures ? scheduledRefreshDelay(wakeAt) : progress;
      if (delay !== false && !cancelled)
        timer = setTimeout(() => {
          void reload().finally(queue);
        }, delay);
    };
    queue();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, enabled, encoded, failures, status, reload, schedule, visible, wakeAt]);
}
