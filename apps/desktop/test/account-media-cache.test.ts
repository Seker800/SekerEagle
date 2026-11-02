import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountCacheNamespaces,
  readAccountCacheStats,
  removeAccountCache,
} from '../src/main/account-media-cache';
import { CacheEngine } from '../src/utility/cache/cache-engine';

describe('account cache maintenance across modes', () => {
  let engine: CacheEngine | undefined;
  let root: string | undefined;
  afterEach(async () => {
    await engine?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it('aggregates both modes and clears only the authenticated account', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-account-cache-'));
    engine = new CacheEngine({ cacheRoot: root, limitBytes: 1024 ** 2, enforceDiskSafety: false });
    await engine.initialize();
    const namespaces = accountCacheNamespaces('https://example.com', {
      ownerId: 'owner',
      deploymentId: 'd'.repeat(64),
    });
    const other = accountCacheNamespaces('https://example.com', {
      ownerId: 'other',
      deploymentId: 'd'.repeat(64),
    });
    for (const [i, namespaceId] of [...namespaces, ...other].entries()) {
      const write = await engine.beginWrite({
        keyHash: Buffer.alloc(32, i + 1),
        namespaceId,
        assetId: '00000000-0000-4000-8000-000000000001',
        kind: 'RENDITION',
        expectedLength: 3,
        now: 1,
      });
      await engine.append(write, Buffer.from('abc'));
      await engine.commit(write, {
        expectedLength: 3,
        contentType: 'image/webp',
        etag: null,
        lastModified: null,
        verifiedAt: 1,
        authorizationLeaseUntil: 1,
      });
    }
    const requestStats = vi.fn(() => ({
      localHitCount: 0,
      revalidatedHitCount: 2,
      missCount: 1,
      coalescedCount: 0,
      errorCount: 0,
      savedBytes: 6,
    }));
    expect(await readAccountCacheStats(engine, namespaces, requestStats)).toMatchObject({
      entryCount: 2,
      logicalBytes: 6,
      requests: { revalidatedHitCount: 4, missCount: 2, savedBytes: 12 },
    });
    expect(
      await removeAccountCache(engine, namespaces, '00000000-0000-4000-8000-000000000001'),
    ).toEqual({ deleted: 2, deferred: 0 });
    expect(await removeAccountCache(engine, namespaces)).toEqual({ deleted: 0, deferred: 0 });
    expect(engine.getStats().entryCount).toBe(2);
  });
});
