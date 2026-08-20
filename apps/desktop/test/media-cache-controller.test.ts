import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaCacheController } from '../src/main/media-cache-controller';
import { CacheEngine } from '../src/utility/cache/cache-engine';

const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const mediaUrl = `sekereagle-media://rendition/${assetId}/${renditionId}`;

describe('MediaCacheController', () => {
  let root: string;
  let engine: CacheEngine;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-media-controller-'));
    engine = new CacheEngine({ cacheRoot: root, limitBytes: 1024 ** 2 });
    await engine.initialize();
    now = 1_000;
  });

  afterEach(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });

  it('downloads an eligible miss once and serves subsequent requests from the local file', async () => {
    const fetchUpstream = vi.fn(async () => eligibleResponse('cached-image'));
    const controller = createController(engine, fetchUpstream, () => now);

    const first = await controller.resolve(mediaUrl);
    expect(first.source).toBe('cache');
    if (first.source !== 'cache') throw new Error('expected cache response');
    expect(await readFile(first.filePath, 'utf8')).toBe('cached-image');
    engine.release(first.leaseId);

    const second = await controller.resolve(mediaUrl);
    expect(second.source).toBe('cache');
    if (second.source === 'cache') engine.release(second.leaseId);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
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
    for (const result of results) {
      expect(result.source).toBe('cache');
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
      serverUrl: 'https://example.com',
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
    if (first.source === 'cache') engine.release(first.leaseId);
    now += 5 * 60_000 + 1;

    const second = await controller.resolve(mediaUrl);

    expect(second.source).toBe('cache');
    if (second.source === 'cache') engine.release(second.leaseId);
    expect(fetchUpstream).toHaveBeenLastCalledWith(
      `/api/eagle/assets/${assetId}/renditions/${renditionId}`,
      { ifNoneMatch: '"etag-1"' },
    );
  });
});

function createController(
  cache: CacheEngine,
  fetchUpstream: (path: string, options: { ifNoneMatch?: string }) => Promise<Response>,
  clock: () => number,
) {
  return new MediaCacheController({
    serverUrl: 'https://example.com',
    cache,
    authenticatedOwner: async () => 'owner-a',
    fetchUpstream,
    now: clock,
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
