import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaSnapshotAuthorization } from '../src/main/media-snapshot-authorization';
import { MediaCacheController } from '../src/main/media-cache-controller';
import { CacheEngine } from '../src/utility/cache/cache-engine';

const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const mediaUrl = `sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`;

describe('MediaCacheController', () => {
  let root: string;
  let engine: CacheEngine;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-media-controller-'));
    engine = new CacheEngine({
      cacheRoot: root,
      limitBytes: 1024 ** 2,
      enforceDiskSafety: false,
    });
    await engine.initialize();
    now = 1_000;
  });

  afterEach(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });

  it('reads cached files with current server-list evidence without a media round trip, and falls back after reset', async () => {
    const identity = { ownerId: 'owner', deploymentId: 'd'.repeat(64) };
    const fetchUpstream = vi.fn(async () => eligibleResponse('image'));
    const snapshot = new MediaSnapshotAuthorization({
      authenticatedOwner: async () => identity,
      fetch: async () =>
        Response.json({
          items: [
            {
              id: assetId,
              libraryMode: 'MATERIAL',
              isPrivate: false,
              deletedAt: null,
              mediaRevision: 1,
              renditions: [
                {
                  id: renditionId,
                  kind: 'THUMBNAIL',
                  revision: 1,
                  byteSize: 5,
                  mimeType: 'image/webp',
                },
              ],
            },
          ],
        }),
    });
    const controller = new MediaCacheController({
      cache: engine,
      authenticatedOwner: async () => identity,
      fetchUpstream,
      canReadLocal: (media, owner, file) => snapshot.allows(media, owner, file),
    });
    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    await snapshot.read('/api/eagle/assets');
    const second = await controller.resolve(mediaUrl);
    expect(second).toMatchObject({ source: 'cache', cacheResult: 'LOCAL' });
    if (second.source === 'cache') await engine.release(second.leaseId);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
    snapshot.reset();
    const third = await controller.resolve(mediaUrl);
    if (third.source === 'cache') await engine.release(third.leaseId);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('serves a cached rendition from disk and revalidates its authorization in the background', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image', '"etag-1"'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: {
            etag: '"etag-1"',
            'x-sekereagle-desktop-cache': 'public-derived-v1',
          },
        }),
      );
    const controller = createController(engine, fetchUpstream, () => now);

    const first = await controller.resolve(mediaUrl);
    expect(first.source).toBe('cache');
    if (first.source !== 'cache') throw new Error('expected committed cache response');
    expect(await readFile(first.filePath, 'utf8')).toBe('cached-image');
    await engine.release(first.leaseId);

    const second = await controller.resolve(mediaUrl);
    expect(second).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
    if (second.source === 'cache') {
      expect(await readFile(second.filePath, 'utf8')).toBe('cached-image');
      engine.release(second.leaseId);
    }
    await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledTimes(2));
    expect(fetchUpstream).toHaveBeenLastCalledWith(
      `/api/eagle/assets/${assetId}/renditions/${renditionId}`,
      { ifNoneMatch: '"etag-1"' },
    );
    expect(engine.getStats().entryCount).toBe(1);
  });

  it('serves a cached rendition before background validation finishes', async () => {
    let releaseValidation!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image', '"etag-1"'))
      .mockImplementationOnce(async () => {
        await gate;
        return new Response(null, {
          status: 304,
          headers: {
            etag: '"etag-1"',
            'x-sekereagle-desktop-cache': 'public-derived-v1',
          },
        });
      });
    const onMediaRevoked = vi.fn();
    const controller = createController(engine, fetchUpstream, () => now, onMediaRevoked);

    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    const second = await controller.resolve(mediaUrl);
    expect(second).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
    if (second.source === 'cache') engine.release(second.leaseId);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
    expect(onMediaRevoked).not.toHaveBeenCalled();
    releaseValidation();
    await vi.waitFor(() => expect(engine.getStats().entryCount).toBe(1));
    expect(onMediaRevoked).not.toHaveBeenCalled();
  });

  it('never shows a cached rendition optimistically when the current list already denies it', async () => {
    const identity = { ownerId: 'owner-a', deploymentId: 'd'.repeat(64) };
    const snapshot = new MediaSnapshotAuthorization({
      authenticatedOwner: async () => identity,
      fetch: async () =>
        Response.json({
          items: [
            {
              id: assetId,
              libraryMode: 'MATERIAL',
              isPrivate: true,
              deletedAt: null,
              mediaRevision: 1,
              renditions: [],
            },
          ],
        }),
    });
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const onMediaRevoked = vi.fn();
    const controller = new MediaCacheController({
      cache: engine,
      authenticatedOwner: async () => identity,
      fetchUpstream,
      now: () => now,
      canReadLocal: (media, owner, file) => snapshot.allows(media, owner, file),
      deniesLocal: (media, owner, file) => snapshot.denies(media, owner, file),
      onMediaRevoked,
    });
    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    await snapshot.read('/api/eagle/assets');
    const second = await controller.resolve(mediaUrl);
    expect(second.source).toBe('upstream');
    if (second.source === 'upstream') expect(second.response.status).toBe(404);
    await vi.waitFor(() => expect(engine.getStats().entryCount).toBe(0));
    expect(onMediaRevoked).not.toHaveBeenCalled();
  });

  it('withdraws an optimistically served image when the server answers 404', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const onMediaRevoked = vi.fn();
    const controller = createController(engine, fetchUpstream, () => now, onMediaRevoked);

    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    const second = await controller.resolve(mediaUrl);
    expect(second).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
    if (second.source === 'cache') engine.release(second.leaseId);

    await vi.waitFor(() =>
      expect(onMediaRevoked).toHaveBeenCalledWith({
        assetId,
        libraryMode: 'MATERIAL',
        status: 404,
      }),
    );
    await vi.waitFor(() => expect(engine.getStats().entryCount).toBe(0));
  });

  it('keeps an optimistically served image when background validation fails transiently', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image'))
      .mockResolvedValueOnce(new Response('try-later', { status: 503 }));
    const onMediaRevoked = vi.fn();
    const controller = createController(engine, fetchUpstream, () => now, onMediaRevoked);

    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    const second = await controller.resolve(mediaUrl);
    expect(second).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
    if (second.source === 'cache') engine.release(second.leaseId);

    await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.getStats().entryCount).toBe(1);
    expect(onMediaRevoked).not.toHaveBeenCalled();
  });

  it('never serves a tile optimistically without current pyramid evidence', async () => {
    const pyramidId = '00000000-0000-4000-8000-00000000000a';
    const tileUrl = `sekereagle-media://tile/${assetId}/${pyramidId}/0/0/0`;
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('tile-image'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: {
            etag: '"etag-1"',
            'x-sekereagle-desktop-cache': 'public-derived-v1',
          },
        }),
      );
    const controller = createController(engine, fetchUpstream, () => now);

    const first = await controller.resolve(tileUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    const second = await controller.resolve(tileUrl);

    expect(second).toMatchObject({ source: 'cache', cacheResult: 'REVALIDATED' });
    if (second.source === 'cache') engine.release(second.leaseId);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent cache misses for the same immutable media key', async () => {
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchUpstream = vi.fn(async () => {
      await gate;
      return eligibleResponse('one-download');
    });
    const controller = createController(engine, fetchUpstream, () => now);

    const first = controller.resolve(mediaUrl);
    const second = controller.resolve(mediaUrl);
    releaseFetch();
    const results = await Promise.all([first, second]);

    expect(fetchUpstream).toHaveBeenCalledTimes(1);
    expect(results.map(({ source }) => source).sort()).toEqual(['cache', 'cache']);
    for (const result of results) {
      if (result.source === 'upstream') expect(await result.response.text()).toBe('one-download');
      if (result.source === 'cache') engine.release(result.leaseId);
    }
  });

  it('never persists a response without explicit public-derived eligibility', async () => {
    const privateResponse = new Response('private-image', {
      status: 200,
      headers: { 'content-type': 'image/webp', 'content-length': '13' },
    });
    const fetchUpstream = vi.fn(async () => privateResponse);
    const controller = createController(engine, fetchUpstream, () => now);

    const result = await controller.resolve(mediaUrl);

    expect(result).toEqual({ source: 'upstream', response: privateResponse });
    expect(engine.getStats().entryCount).toBe(0);
  });

  it('fails closed before lookup or upstream access without a current authenticated owner', async () => {
    const fetchUpstream = vi.fn(async () => eligibleResponse('not-used'));
    const controller = new MediaCacheController({
      cache: engine,
      authenticatedOwner: async () => null,
      fetchUpstream,
      now: () => now,
    });

    const result = await controller.resolve(mediaUrl);

    expect(result.source).toBe('error');
    if (result.source === 'error') expect(result.status).toBe(401);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('propagates consumer cancellation without retrying the upstream request', async () => {
    const fetchUpstream = vi.fn(
      async (_path: string, options: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () =>
              reject(
                options.signal?.reason instanceof Error
                  ? options.signal.reason
                  : new DOMException('Aborted', 'AbortError'),
              ),
            { once: true },
          );
        }),
    );
    const controller = createController(engine, fetchUpstream, () => now);
    const abort = new AbortController();
    const resolution = controller.resolve(mediaUrl, abort.signal);

    await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledTimes(1));
    abort.abort();

    await expect(resolution).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it('revalidates an expired authorization lease with ETag without transferring the body', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image', '"etag-1"'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: {
            etag: '"etag-1"',
            'x-sekereagle-desktop-cache': 'public-derived-v1',
          },
        }),
      );
    const controller = createController(engine, fetchUpstream, () => now);
    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    now += 5 * 60_000 + 1;

    const second = await controller.resolve(mediaUrl);

    expect(second.source).toBe('cache');
    if (second.source === 'cache') engine.release(second.leaseId);
    expect(fetchUpstream).toHaveBeenLastCalledWith(
      `/api/eagle/assets/${assetId}/renditions/${renditionId}`,
      { ifNoneMatch: '"etag-1"' },
    );
  });

  it('rejects malformed custom URLs before authentication and bypasses ineligible body shapes', async () => {
    const authenticatedOwner = vi.fn(async () => ({
      ownerId: 'owner-a',
      deploymentId: 'd'.repeat(64),
    }));
    const fetchUpstream = vi.fn(
      async () =>
        new Response('unknown-size', {
          status: 200,
          headers: {
            'content-type': 'image/webp',
            'x-sekereagle-desktop-cache': 'public-derived-v1',
          },
        }),
    );
    const controller = new MediaCacheController({
      cache: engine,
      authenticatedOwner,
      fetchUpstream,
      now: () => now,
    });

    expect(await controller.resolve('https://attacker.example/image.webp')).toMatchObject({
      source: 'error',
      status: 404,
    });
    expect(authenticatedOwner).not.toHaveBeenCalled();
    const response = await controller.resolve(mediaUrl);
    expect(response.source).toBe('upstream');
    expect(engine.getStats().entryCount).toBe(0);
  });

  it('purges an expired hit when the server withdraws persistence eligibility', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image'))
      .mockResolvedValueOnce(
        new Response('now-private', {
          status: 200,
          headers: { 'content-type': 'image/webp', 'content-length': '11' },
        }),
      );
    const controller = createController(engine, fetchUpstream, () => now);
    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    now += 5 * 60_000 + 1;

    const result = await controller.resolve(mediaUrl);

    expect(result).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
    if (result.source === 'cache') engine.release(result.leaseId);
    await vi.waitFor(() => expect(engine.getStats().entryCount).toBe(0));
  });

  it.each([429, 503])(
    'preserves an expired READY cache entry after transient HTTP %s',
    async (status) => {
      const fetchUpstream = vi
        .fn()
        .mockResolvedValueOnce(eligibleResponse('cached-image'))
        .mockResolvedValueOnce(new Response('try-later', { status }));
      const controller = createController(engine, fetchUpstream, () => now);
      const first = await controller.resolve(mediaUrl);
      if (first.source === 'cache') await engine.release(first.leaseId);
      now += 5 * 60_000 + 1;

      const result = await controller.resolve(mediaUrl);
      expect(result).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
      if (result.source === 'cache') engine.release(result.leaseId);
      await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(engine.getStats().entryCount).toBe(1);
    },
  );

  it('retries upstream without cache when a streaming cache write fails', async () => {
    const fetchUpstream = vi.fn(async () => eligibleResponse('network-fallback'));
    vi.spyOn(engine, 'append').mockRejectedValueOnce(new Error('disk full'));
    const abortWrite = vi.spyOn(engine, 'abort');
    const controller = createController(engine, fetchUpstream, () => now);

    const result = await controller.resolve(mediaUrl);

    expect(result.source).toBe('upstream');
    if (result.source === 'upstream') expect(await result.response.text()).toBe('network-fallback');
    await vi.waitFor(() => expect(abortWrite).toHaveBeenCalledTimes(1));
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
    expect(engine.getStats().entryCount).toBe(0);
  });

  it('does not redownload a revalidated response when its background cache write fails', async () => {
    let releaseValidation!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(eligibleResponse('cached-image'))
      .mockImplementationOnce(async () => {
        await gate;
        return eligibleResponse('new-image', '"etag-2"');
      });
    const controller = createController(engine, fetchUpstream, () => now);
    const first = await controller.resolve(mediaUrl);
    if (first.source === 'cache') await engine.release(first.leaseId);
    now += 5 * 60_000 + 1;
    vi.spyOn(engine, 'append').mockRejectedValueOnce(new Error('disk full'));
    const abortWrite = vi.spyOn(engine, 'abort');

    const result = await controller.resolve(mediaUrl);

    expect(result).toMatchObject({ source: 'cache', cacheResult: 'OPTIMISTIC' });
    if (result.source === 'cache') engine.release(result.leaseId);
    releaseValidation();
    await vi.waitFor(() => expect(abortWrite).toHaveBeenCalledTimes(1));
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('refuses a thumbnail above the dedicated 8 MiB admission ceiling', async () => {
    const fetchUpstream = vi.fn(
      async () =>
        new Response('oversized', {
          status: 200,
          headers: {
            'content-type': 'image/webp',
            'content-length': String(8 * 1024 ** 2 + 1),
            'x-sekereagle-desktop-cache': 'public-derived-v1',
          },
        }),
    );
    const controller = createController(engine, fetchUpstream, () => now);

    expect(await controller.resolve(mediaUrl)).toMatchObject({ source: 'upstream' });
    expect(engine.getStats().entryCount).toBe(0);
  });
});

function createController(
  cache: CacheEngine,
  fetchUpstream: (
    path: string,
    options: { ifNoneMatch?: string; signal?: AbortSignal },
  ) => Promise<Response>,
  clock: () => number,
  onMediaRevoked?: (event: { assetId: string; libraryMode: string; status: number }) => void,
) {
  return new MediaCacheController({
    cache,
    authenticatedOwner: async () => ({ ownerId: 'owner-a', deploymentId: 'd'.repeat(64) }),
    fetchUpstream,
    now: clock,
    ...(onMediaRevoked ? { onMediaRevoked } : {}),
  });
}

function eligibleResponse(body: string, etag = '"etag-1"') {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/webp',
      'content-length': String(Buffer.byteLength(body)),
      etag,
      'x-sekereagle-desktop-cache': 'public-derived-v1',
    },
  });
}
