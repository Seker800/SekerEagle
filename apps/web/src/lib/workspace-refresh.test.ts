import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { acquireWorkspaceRefresh } from './workspace-refresh';
import type { WorkspaceChanges } from '@sekereagle/library-core';
const snapshot = (value = '0'): WorkspaceChanges =>
  ({ epoch: 'epoch', scopes: { MATERIAL: { ASSETS: value }, PHOTO: {} } }) as WorkspaceChanges;
afterEach(() => vi.useRealTimers());
it('shares one timer per client, stops hidden checks, and preserves twelve cached pages', async () => {
  vi.useFakeTimers();
  let visible = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visible as DocumentVisibilityState,
  );
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = ['eagle', 'owner', 'MATERIAL', 'assets', 'ACTIVE', {}];
  const pages = {
    pages: Array.from({ length: 12 }, (_, n) => ({ items: [n] })),
    pageParams: Array(12).fill(null),
  };
  client.setQueryData(key, pages);
  const load = vi.fn().mockResolvedValue(snapshot());
  const release = acquireWorkspaceRefresh(client, 'owner', false, load);
  const second = acquireWorkspaceRefresh(client, 'owner', false, load);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(load).toHaveBeenCalledTimes(11);
  expect(client.getQueryData(key)).toEqual(pages);
  visible = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(load).toHaveBeenCalledTimes(11);
  visible = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(12);
  release();
  second();
  client.clear();
  vi.restoreAllMocks();
});
it('never overlaps slow reads and retries failures with backoff', async () => {
  vi.useFakeTimers();
  let resolve!: (value: WorkspaceChanges) => void;
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<WorkspaceChanges>((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValue(new Error('offline'));
  const release = acquireWorkspaceRefresh(client, 'slow', false, load);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(load).toHaveBeenCalledTimes(1);
  resolve(snapshot());
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(4999);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(3);
  release();
  client.clear();
});

it('stops automatic retries for revoked authentication', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const load = vi.fn().mockRejectedValue(new ApiError('revoked', 401, null));
  const release = acquireWorkspaceRefresh(client, 'revoked', false, load);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(load).toHaveBeenCalledTimes(1);
  release();
  client.clear();
});

it('recalibrates immediately after reconnect, queuing one fresh read behind an older in-flight read', async () => {
  vi.useFakeTimers();
  let resolve!: (value: WorkspaceChanges) => void;
  const client=new QueryClient();
  const load=vi.fn().mockImplementationOnce(()=>new Promise<WorkspaceChanges>((done)=>{resolve=done;}))
    .mockResolvedValue(snapshot('1'));
  const release=acquireWorkspaceRefresh(client,'reconnect',false,load);
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  resolve(snapshot());
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  release();client.clear();
});
