import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { useEagleUploadController } from './useEagleUploadController';
const { material, photo, statuses, dedupeCheck } = vi.hoisted(() => ({
  material: vi.fn(),
  photo: vi.fn(),
  statuses: vi.fn(),
  dedupeCheck: vi.fn(async () => ({ sha256: 'a'.repeat(64), exists: false })),
}));
vi.mock('../../lib/eagle-api', () => ({
  uploadEagleAsset: material,
  getEagleUploadStatuses: statuses,
  checkEagleUploadContentBatch: vi.fn(async () => []),
  createEagleApi: (mode: string) => ({
    uploadEagleAsset: mode === 'PHOTO' ? photo : material,
    getEagleUploadStatuses: statuses,
    checkEagleUploadContentBatch: vi.fn(async () => []),
  }),
}));
vi.mock('../../lib/upload-dedupe', () => ({
  UploadDedupeChecker: class {
    check = dedupeCheck;
  },
}));
it('pins every file of a drag batch to the mode at drop time, including queued files after switching modes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate.then(() => ({})));
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
  const view = renderHook(() => useEagleUploadController(['eagle', 'owner', mode, 'assets']), {
    wrapper,
  });
  const files = ['a', 'b', 'c', 'd', 'e'].map(
    (name) => new File(['jpeg'], `${name}.jpg`, { type: 'image/jpeg' }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = view.result.current.importFiles(files);
  });
  expect(material).toHaveBeenCalledTimes(4);
  mode = 'PHOTO';
  view.rerender();
  await act(async () => {
    release();
    await pending;
  });
  expect(material).toHaveBeenCalledTimes(5);
  expect(photo).not.toHaveBeenCalled();
  await act(async () => {
    await view.result.current.importFiles([files[0]]);
  });
  expect(photo).toHaveBeenCalledOnce();
});

it('skips a file found by the pre-upload check without calling the upload API', async () => {
  dedupeCheck.mockResolvedValueOnce({ sha256: 'b'.repeat(64), exists: true });
  material.mockReset();
  material.mockResolvedValue({});
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => useEagleUploadController(['eagle', 'owner', 'MATERIAL', 'assets']),
    { wrapper },
  );
  await act(async () => {
    await view.result.current.importFiles([new File(['same'], 'same.jpg')]);
  });
  expect(material).not.toHaveBeenCalled();
  expect(view.result.current.uploads[0]?.state).toBe('duplicate');
  expect(view.result.current.summary.duplicate).toBe(1);
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
  material.mockImplementation((file: File, progress: (value: { percent: number }) => void) => {
    progress({ percent: file.name === 'a.jpg' ? 25 : 75 });
    return new Promise<Record<string, never>>((done) => {
      if (file.name === 'a.jpg') finish = () => done({});
      else done({});
    });
  });
  const view = renderHook(
    () => useEagleUploadController(['eagle', 'owner', 'MATERIAL', 'assets']),
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
  expect(view.result.current.summary.completed).toBe(2);
  act(() => view.result.current.dismissUploads());
  expect(view.result.current.uploads).toHaveLength(0);
  await act(async () => {
    await view.result.current.importFiles([]);
    await view.result.current.retryUpload(-1);
  });
  expect(view.result.current.summary.total).toBe(0);
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

it('revoking the browser session aborts active uploads and never starts the queued fifth file', async () => {
  const { fetchWithBrowserSession } = await import('../../lib/api-client');
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  material.mockReset();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate.then(() => ({})));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => useEagleUploadController(['eagle', 'owner', 'MATERIAL', 'assets']),
    { wrapper },
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = view.result.current.importFiles(
      ['a', 'b', 'c', 'd', 'e'].map((name) => new File(['data'], name)),
    );
  });
  expect(material).toHaveBeenCalledTimes(4);
  view.unmount();
  await fetchWithBrowserSession('/api/auth/logout');
  await fetchWithBrowserSession('/api/auth/login');
  await act(async () => {
    release();
    await pending;
  });
  expect(material).toHaveBeenCalledTimes(4);
  expect(material.mock.calls[0]![2].signal.aborted).toBe(true);
  vi.unstubAllGlobals();
});

it('remounting a mode subscribes to its original upload queue', async () => {
  material.mockReset();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate.then(() => ({})));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const hook = () => useEagleUploadController(['eagle', 'owner', 'MATERIAL', 'assets']);
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
  expect(material).toHaveBeenCalledTimes(3);
  expect(second.result.current.uploads.every((item) => item.state === 'completed')).toBe(true);
});
