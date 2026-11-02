import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceChanges } from '@sekereagle/library-core';
import { acquireWorkspaceRefresh, awaitWorkspaceRefreshBaseline } from './workspace-refresh';

afterEach(() => vi.useRealTimers());
const snapshot = {
  epoch: 'epoch',
  scopes: { MATERIAL: { ASSETS: '0' }, PHOTO: {} },
} as WorkspaceChanges;

it('reads the initial list once, after the initial change baseline, rather than re-reading it', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  let ready!: (snapshot: WorkspaceChanges) => void;
  const release = acquireWorkspaceRefresh(
    client,
    'owner',
    false,
    () =>
      new Promise<WorkspaceChanges>((resolve) => {
        ready = resolve;
      }),
  );
  const key = ['eagle', 'owner', 'MATERIAL', 'assets', 'ACTIVE', {}];
  const read = vi.fn().mockResolvedValue('fresh-list');
  const observer = new QueryObserver(client, {
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) => {
      await awaitWorkspaceRefreshBaseline(client, 'owner', false, key, signal);
      signal.throwIfAborted();
      return read();
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(read).not.toHaveBeenCalled();
    ready(snapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toBe('fresh-list');
  } finally {
    unsubscribe();
    release();
    client.clear();
  }
});

it('limits startup waiting and retains the original reconciliation when the baseline is slow', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  let ready!: (snapshot: WorkspaceChanges) => void;
  const release = acquireWorkspaceRefresh(
    client,
    'owner',
    false,
    () =>
      new Promise<WorkspaceChanges>((resolve) => {
        ready = resolve;
      }),
  );
  const key = ['eagle', 'owner', 'MATERIAL', 'assets', 'ACTIVE', {}];
  const read = vi.fn().mockResolvedValue('list');
  const observer = new QueryObserver(client, {
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) => {
      await awaitWorkspaceRefreshBaseline(client, 'owner', false, key, signal);
      signal.throwIfAborted();
      return read();
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(1);
    ready(snapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    release();
    client.clear();
  }
});

it('does not require a refresh observer for isolated views, and cancellation never starts a read', async () => {
  const client = new QueryClient();
  await expect(
    awaitWorkspaceRefreshBaseline(client, 'absent', false, [], new AbortController().signal),
  ).resolves.toBeUndefined();
  vi.useFakeTimers();
  const release = acquireWorkspaceRefresh(
    client,
    'owner',
    false,
    () => new Promise<WorkspaceChanges>(() => undefined),
  );
  const controller = new AbortController();
  const pending = awaitWorkspaceRefreshBaseline(client, 'owner', false, [], controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  release();
  client.clear();
});
