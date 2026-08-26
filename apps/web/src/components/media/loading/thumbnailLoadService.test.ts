import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailLoadService } from './thumbnailLoadService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ThumbnailLoadService', () => {
  it('deduplicates active requests and revokes the shared object URL after its last release', async () => {
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
    expect(revoke).toHaveBeenCalledWith('blob:thumbnail');
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
