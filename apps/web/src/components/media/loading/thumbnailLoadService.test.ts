import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailLoadService } from './thumbnailLoadService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ThumbnailLoadService', () => {
  it('keeps a released thumbnail warm so reopening a folder does not fetch or decode it again', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(new Blob(['image']), { headers: { 'content-type': 'image/webp' } }),
      );
    const revoke = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:thumbnail'),
      revokeObjectURL: revoke,
    });
    const service = new ThumbnailLoadService();
    const firstController = new AbortController();
    const secondController = new AbortController();

    const [first, second] = await Promise.all([
      service.load('asset:revision:rendition', '/media/thumbnail', firstController.signal),
      service.load('asset:revision:rendition', '/media/thumbnail', secondController.signal),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.url).toBe('blob:thumbnail');
    expect(second.url).toBe('blob:thumbnail');
    first.release();
    expect(revoke).not.toHaveBeenCalled();
    second.release();
    expect(revoke).not.toHaveBeenCalled();

    const reopened = await service.load(
      'asset:revision:rendition',
      '/media/thumbnail',
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reopened.url).toBe('blob:thumbnail');
    reopened.release();
  });

  it('evicts only the least recently used released thumbnail after the generous entry limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      new Response(new Blob([String(url)]), { headers: { 'content-type': 'image/webp' } }),
    );
    const revoke = vi.fn();
    let objectUrlIndex = 0;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:thumbnail-${++objectUrlIndex}`),
      revokeObjectURL: revoke,
    });
    const service = new ThumbnailLoadService({
      maxEntries: 2,
      maxBytes: Number.POSITIVE_INFINITY,
      maxIdleMs: Number.POSITIVE_INFINITY,
    });

    const first = await service.load('first', '/first', new AbortController().signal);
    first.release();
    const second = await service.load('second', '/second', new AbortController().signal);
    second.release();
    const firstAgain = await service.load('first', '/first', new AbortController().signal);
    firstAgain.release();
    const third = await service.load('third', '/third', new AbortController().signal);

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:thumbnail-2');
    third.release();
  });

  it('also bounds released thumbnails by encoded byte size', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(new Blob(['1234']), { headers: { 'content-type': 'image/webp' } }),
    );
    const revoke = vi.fn();
    let objectUrlIndex = 0;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:thumbnail-${++objectUrlIndex}`),
      revokeObjectURL: revoke,
    });
    const service = new ThumbnailLoadService({
      maxEntries: 10,
      maxBytes: 5,
      maxIdleMs: Number.POSITIVE_INFINITY,
    });

    const first = await service.load('first', '/first', new AbortController().signal);
    first.release();
    const second = await service.load('second', '/second', new AbortController().signal);

    expect(revoke).toHaveBeenCalledWith('blob:thumbnail-1');
    second.release();
  });

  it('classifies 429 without replacing it with a generic image failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 429, headers: { 'retry-after': '3' } }),
    );
    const service = new ThumbnailLoadService();

    await expect(
      service.load('limited', '/media/limited', new AbortController().signal),
    ).rejects.toMatchObject({
      failure: 'rate-limited',
      retryAfterMs: 3_000,
    });
  });

  it('aborts the underlying request after the final waiting consumer leaves', async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const service = new ThumbnailLoadService();
    const first = new AbortController();
    const second = new AbortController();
    const firstLoad = service.load('shared', '/media/shared', first.signal).catch(() => undefined);
    const secondLoad = service
      .load('shared', '/media/shared', second.signal)
      .catch(() => undefined);

    first.abort();
    await Promise.resolve();
    expect(upstreamSignal?.aborted).toBe(false);
    second.abort();
    await Promise.all([firstLoad, secondLoad]);
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
