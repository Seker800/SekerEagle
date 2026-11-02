import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaCacheController } from '../src/main/media-cache-controller';
import {
  buildCacheIdentity,
  buildNamespaceId,
  createDesktopMediaUrl,
  parseDesktopMediaUrl,
} from '../src/shared/media-identity';
import { CacheEngine } from '../src/utility/cache/cache-engine';

const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const deploymentId = 'd'.repeat(64);
const server = 'https://example.com';
const scopedUrl = (mode: string) =>
  `sekereagle-media://rendition/${mode}/thumbnail/${assetId}/${renditionId}`;

describe('mode-scoped desktop media cache', () => {
  let root: string;
  let engine: CacheEngine;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-scope-'));
    engine = new CacheEngine({ cacheRoot: root, limitBytes: 1024 ** 2, enforceDiskSafety: false });
    await engine.initialize();
  });
  afterEach(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });

  it('round trips an explicit mode, separates keys/namespaces, and preserves legacy material keys', () => {
    const photo = parseDesktopMediaUrl(scopedUrl('photo'));
    const material = parseDesktopMediaUrl(scopedUrl('material'));
    const legacy = parseDesktopMediaUrl(
      `sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`,
    );
    expect(photo.libraryMode).toBe('PHOTO');
    expect(createDesktopMediaUrl(photo)).toBe(scopedUrl('photo'));
    expect(buildCacheIdentity(server, 'owner', deploymentId, photo)).not.toBe(
      buildCacheIdentity(server, 'owner', deploymentId, material),
    );
    expect(buildCacheIdentity(server, 'owner', deploymentId, material)).toBe(
      buildCacheIdentity(server, 'owner', deploymentId, legacy),
    );
    expect(buildNamespaceId(server, 'owner', deploymentId, 'PHOTO')).not.toBe(
      buildNamespaceId(server, 'owner', deploymentId, 'MATERIAL'),
    );
  });

  it.each(['unknown', '..', 'PHOTO%2fmaterial'])('rejects an invalid mode segment %s', (mode) => {
    expect(() => parseDesktopMediaUrl(scopedUrl(mode))).toThrow();
  });

  it('never serves material bytes to a photo request with the same media IDs', async () => {
    const upstream = vi.fn(async (url: string) =>
      eligible(url.startsWith('/api/photos/') ? 'photo' : 'material'),
    );
    const controller = makeController(upstream);
    for (const [mode, bytes] of [
      ['material', 'material'],
      ['photo', 'photo'],
    ] as const) {
      const result = await controller.resolve(scopedUrl(mode));
      expect(result.source).toBe('cache');
      if (result.source !== 'cache') throw new Error('Expected cached media');
      expect(await readFile(result.filePath, 'utf8')).toBe(bytes);
      await engine.release(result.leaseId);
    }
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([
      `/api/eagle/assets/${assetId}/renditions/${renditionId}`,
      `/api/photos/assets/${assetId}/renditions/${renditionId}`,
    ]);
    expect(engine.getStats().entryCount).toBe(2);
  });

  it('counts one network miss and one revalidated hit, without counting internal file acquisitions', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(eligible('photo'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: { etag: '"media"', 'x-sekereagle-desktop-cache': 'public-derived-v1' },
        }),
      );
    const controller = makeController(upstream);
    const namespace = buildNamespaceId(server, 'owner', deploymentId, 'PHOTO');
    const first = await controller.resolve(scopedUrl('photo'));
    if (first.source !== 'cache') throw new Error('Expected cache');
    await engine.release(first.leaseId);
    expect(controller.getRequestStats(namespace)).toMatchObject({
      localHitCount: 0,
      revalidatedHitCount: 0,
      missCount: 1,
      savedBytes: 0,
    });
    const second = await controller.resolve(scopedUrl('photo'));
    if (second.source !== 'cache') throw new Error('Expected cache');
    await engine.release(second.leaseId);
    expect(controller.getRequestStats(namespace)).toMatchObject({
      localHitCount: 0,
      revalidatedHitCount: 1,
      missCount: 1,
      savedBytes: 5,
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('does not store private photo responses and never serves a cached photo after a 404', async () => {
    const privateResponse = new Response('private', {
      headers: { 'content-type': 'image/webp', 'content-length': '7' },
    });
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(privateResponse)
      .mockResolvedValueOnce(eligible('photo'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const controller = makeController(upstream);
    expect((await controller.resolve(scopedUrl('photo'))).source).toBe('upstream');
    expect(engine.getStats().entryCount).toBe(0);
    const cached = await controller.resolve(scopedUrl('photo'));
    if (cached.source !== 'cache') throw new Error('Expected cache');
    await engine.release(cached.leaseId);
    const revoked = await controller.resolve(scopedUrl('photo'));
    expect(revoked.source).toBe('upstream');
    if (revoked.source === 'upstream') expect(revoked.response.status).toBe(404);
    expect(engine.getStats().entryCount).toBe(0);
  });

  function makeController(fetchUpstream: (url: string) => Promise<Response>) {
    return new MediaCacheController({
      serverUrl: server,
      cache: engine,
      authenticatedOwner: async () => ({ ownerId: 'owner', deploymentId }),
      fetchUpstream,
      now: () => 1000,
    });
  }
});

function eligible(body: string) {
  return new Response(body, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(Buffer.byteLength(body)),
      etag: '"media"',
      'x-sekereagle-desktop-cache': 'public-derived-v1',
    },
  });
}
