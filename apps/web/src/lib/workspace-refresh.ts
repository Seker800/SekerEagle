import { t } from '../i18n';
import { hashKey, type QueryClient, type Query } from '@tanstack/react-query';
import {
  WORKSPACE_CHANGE_KINDS,
  type WorkspaceChanges,
  type WorkspaceChangeKind,
} from '@sekereagle/library-core';
import { request } from './api-client';
import { ApiError } from './api-error';
import { retryRefreshDelay } from './refresh-policy';

export const workspaceRefreshKey = (ownerId: string, includePrivate: boolean) =>
  ['workspace-changes', ownerId, includePrivate] as const;
export type WorkspaceRefreshObservation = { snapshot?: WorkspaceChanges; error?: string };
type Load = (signal: AbortSignal) => Promise<WorkspaceChanges>;
type Registration = {
  refs: number;
  stop: () => void;
  waitForBaseline: (queryKey: readonly unknown[], signal: AbortSignal) => Promise<void>;
};
const registries = new WeakMap<QueryClient, Map<string, Registration>>();

/** Start the first list after the existing lightweight check. Slow or failed
 * checks retain the original read + reconciliation, never a permission grant. */
export function awaitWorkspaceRefreshBaseline(
  client: QueryClient,
  ownerId: string,
  includePrivate: boolean,
  queryKey: readonly unknown[],
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return (
    registries
      .get(client)
      ?.get(JSON.stringify([ownerId, includePrivate]))
      ?.waitForBaseline(queryKey, signal) ?? Promise.resolve()
  );
}

const resources: Record<WorkspaceChangeKind, readonly string[]> = {
  ASSETS: [
    'assets',
    'asset-detail',
    'statistics',
    'timeline',
    'photography-facets',
    'duplicates',
    'stack-asset',
  ],
  LABELS: ['manual-tags', 'manual-tag-groups', 'ai-tags'],
  PEOPLE: ['people', 'people-summary', 'people-merge-targets', 'person-review', 'person-faces'],
  MAP: ['map', 'map-photos'],
  FOLDERS: ['smart-folders'],
  RECOMMENDATIONS: ['vector-summary'],
  OPERATIONS: ['operations'],
  TASKS: ['processing', 'vector-processing'],
  SETTINGS: ['processing', 'vector-processing'],
  AGENT: ['agent'],
};
function affected(
  query: Query,
  ownerId: string,
  mode: string,
  kinds: ReadonlySet<WorkspaceChangeKind>,
) {
  const key = query.queryKey;
  if (key[0] === 'task-center')
    return (
      key[1] === ownerId &&
      key[2] === mode &&
      (kinds.has('TASKS') || kinds.has('SETTINGS') || kinds.has('AGENT'))
    );
  if (key[0] !== 'eagle' || key[1] !== ownerId || key[2] !== mode) return false;
  if ([...kinds].some((kind) => resources[kind].includes(String(key[3])))) return true;
  return (
    kinds.has('FOLDERS') &&
    key[3] === 'assets' &&
    Boolean((key[5] as { smartFolderId?: string } | undefined)?.smartFolderId)
  );
}

/** One transport observer per QueryClient and authorization scope, regardless of mode/components. */
export function acquireWorkspaceRefresh(
  client: QueryClient,
  ownerId: string,
  includePrivate: boolean,
  load: Load = (signal) => request<WorkspaceChanges>('/api/library/changes', { signal }),
) {
  let registry = registries.get(client);
  if (!registry) {
    registry = new Map();
    registries.set(client, registry);
  }
  const identity = JSON.stringify([ownerId, includePrivate]);
  const existing = registry.get(identity);
  if (existing) {
    existing.refs++;
    return () => {
      if (--existing.refs === 0) {
        existing.stop();
        registry.delete(identity);
      }
    };
  }
  let stopped = false,
    inFlight = false,
    failures = 0;
  let revoked = false;
  let wakePending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: WorkspaceChanges | undefined;
  const controller = new AbortController();
  const key = workspaceRefreshKey(ownerId, includePrivate);
  let initialSettled = false;
  let settleInitial!: () => void;
  const initial = new Promise<void>((resolve) => {
    settleInitial = resolve;
  });
  const waitingForBaseline = new Set<string>();
  const finishInitial = () => {
    initialSettled = true;
    settleInitial();
  };
  const queued = new Map<string, { query: Query; running: boolean; again: boolean }>();
  const visible = () => document.visibilityState === 'visible';
  const reconcile = (query: Query) => {
    let work = queued.get(query.queryHash);
    if (!work) {
      work = { query, running: false, again: false };
      queued.set(query.queryHash, work);
    }
    if (work.running) {
      work.again = true;
      return;
    }
    if (!visible()) {
      void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' });
      return;
    }
    work.running = true;
    void (async () => {
      do {
        work.again = false;
        // A read started before the change may return an old snapshot. Finish it,
        // then fetch once more rather than cancelling or overlapping it.
        if (query.state.fetchStatus === 'fetching') await query.promise?.catch(() => undefined);
        if (stopped) return;
        if (!visible()) {
          work.again = true;
          break;
        }
        await client.invalidateQueries(
          { queryKey: query.queryKey, exact: true },
          { cancelRefetch: false },
        );
      } while (work.again && !stopped);
    })().finally(() => {
      work.running = false;
      if (!work.again) queued.delete(query.queryHash);
    });
  };
  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    if (!stopped && !revoked && visible())
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, delay);
  };
  const run = async () => {
    if (stopped || revoked || inFlight || !visible()) return;
    inFlight = true;
    let delay = 60_000;
    try {
      const next = await load(controller.signal);
      if (stopped || !visible()) return;
      failures = 0;
      // These reads have not started their HTTP request yet. Other existing
      // queries still need the original conservative initial reconciliation.
      const startsAfterBaseline = new Set(waitingForBaseline);
      client.setQueryData<WorkspaceRefreshObservation>(key, { snapshot: next });
      finishInitial();
      for (const mode of ['MATERIAL', 'PHOTO'] as const) {
        const kinds = new Set(
          WORKSPACE_CHANGE_KINDS.filter(
            (kind) =>
              !previous ||
              previous.epoch !== next.epoch ||
              previous.scopes[mode][kind] !== next.scopes[mode][kind],
          ),
        );
        if (previous && JSON.stringify(previous.health) !== JSON.stringify(next.health))
          kinds.add('TASKS');
        if (kinds.size)
          for (const query of client.getQueryCache().getAll())
            if (
              affected(query, ownerId, mode, kinds) &&
              (previous || !startsAfterBaseline.has(query.queryHash))
            )
              reconcile(query);
      }
      previous = next;
    } catch (error) {
      if (stopped || !visible()) return;
      client.setQueryData<WorkspaceRefreshObservation>(key, (value) => ({
        ...value,
        error: error instanceof Error ? error.message : t('自动更新暂时不可用，现有结果已保留。'),
      }));
      finishInitial();
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        revoked = true;
        return;
      }
      delay = retryRefreshDelay(++failures);
    } finally {
      inFlight = false;
      const nextDelay = wakePending ? 0 : delay;
      wakePending = false;
      if (!stopped && !revoked && visible()) schedule(nextDelay);
    }
  };
  const wake = () => {
    if (timer) clearTimeout(timer);
    if (!visible() || stopped) return;
    for (const { query, running } of queued.values()) if (!running) reconcile(query);
    if (inFlight) wakePending = true;
    else schedule(0);
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  schedule(0);
  const entry = {
    refs: 1,
    waitForBaseline(queryKey: readonly unknown[], signal: AbortSignal): Promise<void> {
      if (initialSettled || !visible()) return Promise.resolve();
      const hash = hashKey(queryKey);
      const configured = Number(import.meta.env.VITE_WORKSPACE_STARTUP_CHECK_MS ?? 250);
      const budget = Number.isFinite(configured) && configured >= 0 ? configured : 250;
      return new Promise<void>((resolve, reject) => {
        let finished = false;
        const finish = (aborted = false) => {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          signal.removeEventListener('abort', abort);
          waitingForBaseline.delete(hash);
          if (aborted) reject(signal.reason);
          else resolve();
        };
        const abort = () => finish(true);
        const deadline = setTimeout(() => finish(), budget);
        waitingForBaseline.add(hash);
        signal.addEventListener('abort', abort, { once: true });
        void initial.then(() => finish());
        if (signal.aborted) abort();
      });
    },
    stop: () => {
      stopped = true;
      finishInitial();
      controller.abort();
      if (timer) clearTimeout(timer);
      queued.clear();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    },
  };
  registry.set(identity, entry);
  return () => {
    if (--entry.refs === 0) {
      entry.stop();
      registry.delete(identity);
    }
  };
}
