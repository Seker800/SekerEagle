import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { useEagleUploadController } from './useEagleUploadController';
const { material, photo } = vi.hoisted(() => ({ material: vi.fn(), photo: vi.fn() }));
vi.mock('../../lib/eagle-api', () => ({
  uploadEagleAsset: material,
  createEagleApi: (mode: string) => ({ uploadEagleAsset: mode === 'PHOTO' ? photo : material }),
}));
it('pins every file of a drag batch to the mode at drop time, including queued files after switching modes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate);
  photo.mockResolvedValue({});
  let mode: 'MATERIAL' | 'PHOTO' = 'MATERIAL';
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode={mode}>
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => useEagleUploadController('', ['eagle', 'owner', mode, 'assets']), {
    wrapper,
  });
  const files = ['a', 'b', 'c'].map(
    (name) => new File(['jpeg'], `${name}.jpg`, { type: 'image/jpeg' }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = view.result.current.importFiles(files);
  });
  expect(material).toHaveBeenCalledTimes(2);
  mode = 'PHOTO';
  view.rerender();
  await act(async () => {
    release();
    await pending;
  });
  expect(material).toHaveBeenCalledTimes(3);
  expect(photo).not.toHaveBeenCalled();
  await act(async () => {
    await view.result.current.importFiles([files[0]]);
  });
  expect(photo).toHaveBeenCalledOnce();
});

it('keeps independent file progress, all failures and a dismissible success summary', async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  material.mockReset();
  let finish!: () => void;
  material.mockImplementation(
    (_token: string, file: File, progress: (value: { percent: number }) => void) => {
      progress({ percent: file.name === 'a.jpg' ? 25 : 75 });
      return new Promise<void>((done) => {
        if (file.name === 'a.jpg') finish = done;
        else done();
      });
    },
  );
  const view = renderHook(
    () => useEagleUploadController('', ['eagle', 'owner', 'MATERIAL', 'assets']),
    { wrapper },
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = view.result.current.importFiles([new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]);
  });
  expect(view.result.current.uploads.find((item) => item.name === 'a.jpg')?.percent).toBe(25);
  await act(async () => {
    await view.result.current.retryUpload(view.result.current.uploads[0]!.id);
  });
  expect(material).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish();
    await pending;
  });
  expect(view.result.current.uploads.every((item) => item.state === 'completed')).toBe(true);
  expect(view.result.current.uploadStatus).toContain('2/2');
  act(() => view.result.current.dismissUploads());
  expect(view.result.current.uploads).toHaveLength(0);
  await act(async () => {
    await view.result.current.importFiles([]);
    await view.result.current.retryUpload(-1);
  });
  expect(view.result.current.uploadStatus).toBeNull();
  material.mockRejectedValue(new Error('网络断开'));
  await act(async () => {
    await view.result.current.importFiles([new File(['c'], 'c.jpg'), new File(['d'], 'd.jpg')]);
  });
  expect(view.result.current.uploads.filter((item) => item.state === 'failed')).toHaveLength(2);
  material.mockResolvedValue({});
  const failed = view.result.current.uploads[0];
  await act(async () => {
    await view.result.current.retryUpload(failed.id);
  });
  expect(view.result.current.uploads.find((item) => item.id === failed.id)?.state).toBe(
    'completed',
  );
  expect(view.result.current.uploads.find((item) => item.name === 'd.jpg')?.error).toContain(
    '网络断开',
  );
});

it('revoking the browser session aborts active uploads and never starts the third queued file', async () => {
  const { fetchWithBrowserSession } = await import('../../lib/api-client');
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  material.mockReset();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => useEagleUploadController('', ['eagle', 'owner', 'MATERIAL', 'assets']),
    { wrapper },
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = view.result.current.importFiles(
      ['a', 'b', 'c'].map((name) => new File(['data'], name)),
    );
  });
  expect(material).toHaveBeenCalledTimes(2);
  view.unmount();
  await fetchWithBrowserSession('/api/auth/logout');
  await fetchWithBrowserSession('/api/auth/login');
  await act(async () => {
    release();
    await pending;
  });
  expect(material).toHaveBeenCalledTimes(2);
  expect(material.mock.calls[0]![3].signal.aborted).toBe(true);
  vi.unstubAllGlobals();
});

it('remounting a mode subscribes to its original upload queue and keeps the original two slots', async () => {
  material.mockReset();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const hook = () => useEagleUploadController('', ['eagle', 'owner', 'MATERIAL', 'assets']);
  const first = renderHook(hook, { wrapper });
  let pending!: Promise<void>;
  await act(async () => {
    pending = first.result.current.importFiles([new File(['a'], 'a'), new File(['b'], 'b')]);
  });
  first.unmount();
  const second = renderHook(hook, { wrapper });
  expect(second.result.current.uploads).toHaveLength(2);
  let next!: Promise<void>;
  await act(async () => {
    next = second.result.current.importFiles([new File(['c'], 'c')]);
  });
  expect(material).toHaveBeenCalledTimes(2);
  await act(async () => {
    release();
    await pending;
    await next;
  });
  expect(second.result.current.uploads.every((item) => item.state === 'completed')).toBe(true);
});
