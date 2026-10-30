import { afterEach, expect, it, vi } from 'vitest';
import { OriginalDownloadQueue } from './original-download-queue';
const get = vi.hoisted(() => vi.fn());
vi.mock('./api-client', () => ({ fetchWithBrowserSession: get }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('waits for an explicit folder choice, streams each file and retries only failures', async () => {
  const writes: string[] = [],
    removed: string[] = [];
  const folder = {
    getFileHandle: async (name: string) => ({
      createWritable: async () => ({
        write: async () => {
          writes.push(name);
        },
        close: async () => undefined,
        abort: async () => undefined,
      }),
    }),
    removeEntry: async (name: string) => {
      removed.push(name);
    },
  };
  vi.stubGlobal(
    'showDirectoryPicker',
    vi.fn().mockResolvedValue({ getDirectoryHandle: async () => folder }),
  );
  get
    .mockResolvedValueOnce(new Response('missing', { status: 404 }))
    .mockResolvedValueOnce(
      new Response(new Uint8Array([2]), { headers: { 'content-length': '1' } }),
    );
  const release = vi.fn();
  const queue = new OriginalDownloadQueue(() => release);
  queue.enqueue([
    { id: 'a', originalName: 'same.jpg' },
    { id: 'b', originalName: 'same.jpg' },
  ]);
  expect(get).not.toHaveBeenCalled();
  await queue.saveToDirectory();
  expect(queue.getSnapshot().items.map((item) => item.state)).toEqual(['failed', 'completed']);
  expect(removed).toHaveLength(1);
  expect(release).toHaveBeenCalledOnce();
  get.mockResolvedValueOnce(
    new Response(new Uint8Array([1]), { headers: { 'content-length': '1' } }),
  );
  await queue.saveToDirectory();
  expect(queue.getSnapshot().items.every((item) => item.state === 'completed')).toBe(true);
  expect(get).toHaveBeenCalledTimes(3);
  expect(new Set(writes).size).toBe(2);
});
it('clears names and cancels pending requests when the owning scope is revoked', async () => {
  vi.stubGlobal(
    'showDirectoryPicker',
    vi
      .fn()
      .mockResolvedValue({
        getDirectoryHandle: async () => ({
          getFileHandle: async () => ({
            createWritable: async () => ({ write: vi.fn(), close: vi.fn(), abort: vi.fn() }),
          }),
          removeEntry: vi.fn(),
        }),
      }),
  );
  let requested!: () => void;
  const started = new Promise<void>((done) => {
    requested = done;
  });
  get.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        requested();
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  const queue = new OriginalDownloadQueue();
  queue.enqueue([{ id: 'a', originalName: 'private.jpg' }]);
  const pending = queue.saveToDirectory();
  await started;
  queue.clear();
  await pending;
  expect(queue.getSnapshot().items).toHaveLength(0);
});
