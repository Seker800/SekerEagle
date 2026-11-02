import { QueryClient, QueryObserver, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createElement, Fragment } from 'react';
import { act, render } from '@testing-library/react';
import { WorkspaceRefresh } from './useWorkspaceRefresh';
import * as apiClient from './api-client';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceChanges } from '@sekereagle/library-core';
import { acquireWorkspaceRefresh, awaitWorkspaceRefreshBaseline } from './workspace-refresh';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const snapshot = {
  epoch: 'epoch',
  scopes: { MATERIAL: { ASSETS: '0' }, PHOTO: {} },
} as WorkspaceChanges;

it('shares the initial baseline when mounted in the real React sibling order', async () => {
  vi.useFakeTimers();
  vi.spyOn(apiClient, 'request').mockResolvedValue(snapshot);
  const client = new QueryClient();
  const key = ['eagle', 'react-owner', 'MATERIAL', 'assets', 'ACTIVE', {}];
  const read = vi.fn().mockResolvedValue('list');
  function List() {
    useQuery({
      queryKey: key,
      retry: false,
      queryFn: async ({ signal }) => {
        const baseline = awaitWorkspaceRefreshBaseline(client, 'react-owner', false, key, signal);
        if (baseline) await baseline;
        signal.throwIfAborted();
        return read();
      },
    });
    return null;
  }
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        Fragment,
        null,
        createElement(WorkspaceRefresh, { ownerId: 'react-owner', includePrivate: false }),
        createElement(List),
      ),
    ),
  );
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    client.clear();
  }
});

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
  expect(
    awaitWorkspaceRefreshBaseline(client, 'absent', false, [], new AbortController().signal),
  ).toBeUndefined();
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
