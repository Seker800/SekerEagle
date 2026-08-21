import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheEngine } from '../src/utility/cache/cache-engine';

const namespaceA = 'a'.repeat(64);
const namespaceB = 'b'.repeat(64);
const hash = (value: number) => Buffer.alloc(32, value);
const asset = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe('CacheEngine', () => {
  let root: string;
  let engine: CacheEngine;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-engine-'));
    engine = new CacheEngine({
      cacheRoot: root,
      limitBytes: 12 * 1024,
      accountInfrastructureBytes: false,
      enforceDiskSafety: false,
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });

  it('streams a bounded write into an atomic ready entry and isolates lookup by namespace', async () => {
    const writeId = await engine.beginWrite({
      keyHash: hash(1),
      namespaceId: namespaceA,
      assetId: asset(1),
      kind: 'RENDITION',
      expectedLength: 12,
      now: 10,
    });
    await engine.append(writeId, Buffer.from('cached-'));
    await engine.append(writeId, Buffer.from('media'));
    await engine.commit(writeId, {
      expectedLength: 12,
      contentType: 'image/webp',
      etag: '"etag-1"',
      lastModified: null,
      verifiedAt: 11,
      authorizationLeaseUntil: 311,
    });

    expect(await engine.acquire(hash(1), namespaceB, 20)).toBeNull();
    const hit = await engine.acquire(hash(1), namespaceA, 20);
    expect(hit).toMatchObject({
      contentType: 'image/webp',
      logicalBytes: 12,
      authorizationLeaseUntil: 311,
    });
    expect(hit?.filePath.startsWith(root)).toBe(true);
    engine.release(hit!.leaseId);
  });

  it('deduplicates concurrent writers and removes a length-mismatched partial', async () => {
    const writeId = await engine.beginWrite({
      keyHash: hash(2),
      namespaceId: namespaceA,
      assetId: asset(2),
      kind: 'TILE',
      expectedLength: 10,
      now: 10,
    });
    await expect(
      engine.beginWrite({
        keyHash: hash(2),
        namespaceId: namespaceA,
        assetId: asset(2),
        kind: 'TILE',
        expectedLength: 10,
        now: 10,
      }),
    ).rejects.toThrow(/写入中/);
    await engine.append(writeId, Buffer.from('short'));
    await expect(
      engine.commit(writeId, {
        expectedLength: 10,
        contentType: 'image/webp',
        etag: null,
        lastModified: null,
        verifiedAt: 11,
        authorizationLeaseUntil: 311,
      }),
    ).rejects.toThrow(/长度/);
    expect(await engine.acquire(hash(2), namespaceA, 20)).toBeNull();
  });

  it('batches hit metadata and promotes reuse without per-hit SQLite writes', async () => {
    await writeReady(engine, 3, namespaceA, 'one');
    const first = await engine.acquire(hash(3), namespaceA, 20);
    engine.release(first!.leaseId);
    const second = await engine.acquire(hash(3), namespaceA, 21);
    engine.release(second!.leaseId);

    expect(engine.pendingAccessCount()).toBe(2);
    expect(engine.inspectEntry(hash(3))).toMatchObject({ accessCount: 0, segment: 'PROBATION' });
    engine.flushAccesses();
    expect(engine.inspectEntry(hash(3))).toMatchObject({ accessCount: 2, segment: 'PROTECTED' });
  });

  it('does not evict an active read lease and converges below the low watermark later', async () => {
    await writeReady(engine, 4, namespaceA, 'a'.repeat(4_096));
    const leased = await engine.acquire(hash(4), namespaceA, 20);
    await writeReady(engine, 5, namespaceA, 'b'.repeat(4_096));
    await writeReady(engine, 6, namespaceA, 'c'.repeat(4_096));

    await engine.evictIfNeeded();
    expect(await engine.acquire(hash(4), namespaceA, 30)).not.toBeNull();
    engine.release(leased!.leaseId);
    engine.releaseAllForTesting();
    await engine.evictIfNeeded();

    expect(engine.getStats().allocatedBytes).toBeLessThanOrEqual(Math.floor(12 * 1024 * 0.9));
  });

  it('recovers interrupted writes from SQLite state without a full cache tree scan', async () => {
    await engine.beginWrite({
      keyHash: hash(7),
      namespaceId: namespaceA,
      assetId: asset(7),
      kind: 'RENDITION',
      expectedLength: 1,
      now: 10,
    });
    await engine.close();

    engine = new CacheEngine({
      cacheRoot: root,
      limitBytes: 12 * 1024,
      accountInfrastructureBytes: false,
      enforceDiskSafety: false,
    });
    const recovery = await engine.initialize();

    expect(recovery.interruptedWrites).toBe(1);
    expect(recovery.fullTreeScans).toBe(0);
    expect(await engine.acquire(hash(7), namespaceA, 20)).toBeNull();
  });

  it('fails safely for invalid write chunks, missing sessions, and active invalidation', async () => {
    expect(() => new CacheEngine({ cacheRoot: root, limitBytes: 0 })).toThrow(/容量/);
    const writeId = await engine.beginWrite({
      keyHash: hash(8),
      namespaceId: namespaceA,
      assetId: asset(8),
      kind: 'RENDITION',
      expectedLength: 1,
      now: 1,
    });
    await expect(engine.append(writeId, Buffer.alloc(0))).rejects.toThrow(/写入块/);
    await expect(engine.append('missing', Buffer.from('x'))).rejects.toThrow(/会话/);
    await engine.abort(writeId);
    await engine.abort(writeId);

    await writeReady(engine, 9, namespaceA, 'leased');
    const hit = await engine.acquire(hash(9), namespaceA, 2);
    await expect(engine.invalidate(hash(9))).rejects.toThrow(/读取中/);
    engine.release(hit!.leaseId);
    await expect(engine.invalidate(hash(9))).resolves.toBe(true);
    await expect(engine.invalidate(hash(9))).resolves.toBe(false);
  });

  it('includes index files in the physical quota and rejects writes below the disk safety line', async () => {
    const physical = new CacheEngine({
      cacheRoot: path.join(root, 'physical'),
      limitBytes: 1024 ** 2,
      diskSpace: async () => ({ freeBytes: 10 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }),
    });
    await physical.initialize();
    expect(await physical.getPhysicalUsageBytes()).toBeGreaterThan(0);
    await physical.close();

    const unsafe = new CacheEngine({
      cacheRoot: path.join(root, 'unsafe'),
      limitBytes: 1024 ** 2,
      diskSpace: async () => ({ freeBytes: 4 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }),
    });
    await unsafe.initialize();
    await expect(
      unsafe.beginWrite({
        keyHash: hash(19),
        namespaceId: namespaceA,
        assetId: asset(19),
        kind: 'RENDITION',
        expectedLength: 1,
        now: 1,
      }),
    ).rejects.toThrow(/安全线/);
    await unsafe.close();
  });

  it('caps the proportional disk reserve so large disks can still cache above the 5 GiB floor', async () => {
    const largeDisk = new CacheEngine({
      cacheRoot: path.join(root, 'large-disk'),
      limitBytes: 10 * 1024 ** 3,
      diskSpace: async () => ({ freeBytes: 6 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 }),
    });
    await largeDisk.initialize();

    const writeId = await largeDisk.beginWrite({
      keyHash: hash(24),
      namespaceId: namespaceA,
      assetId: asset(24),
      kind: 'RENDITION',
      expectedLength: 1,
      now: 1,
    });

    await largeDisk.abort(writeId);
    await largeDisk.close();
  });

  it('invalidates every derivative for one asset without crossing owner namespaces', async () => {
    await engine.setLimitBytes(64 * 1024);
    await writeReady(engine, 20, namespaceA, 'asset-a-rendition', asset(20));
    await writeReady(engine, 21, namespaceA, 'asset-a-tile', asset(20));
    await writeReady(engine, 22, namespaceA, 'asset-b', asset(22));
    await writeReady(engine, 23, namespaceB, 'other-owner', asset(20));

    const leased = await engine.acquire(hash(20), namespaceA, 30);
    await expect(engine.invalidateAsset(namespaceA, asset(20))).resolves.toEqual({
      deleted: 1,
      deferred: 1,
    });
    expect(await engine.acquire(hash(21), namespaceA, 31)).toBeNull();
    expect(await engine.acquire(hash(22), namespaceA, 31)).not.toBeNull();
    expect(await engine.acquire(hash(23), namespaceB, 31)).not.toBeNull();

    await engine.release(leased!.leaseId);
    expect(await engine.acquire(hash(20), namespaceA, 32)).toBeNull();
  });

  it('persists a deferred invalidation across a cache-process restart', async () => {
    await writeReady(engine, 26, namespaceA, 'leased-before-restart', asset(26));
    const leased = await engine.acquire(hash(26), namespaceA, 30);
    expect(leased).not.toBeNull();
    await expect(engine.invalidateAsset(namespaceA, asset(26))).resolves.toEqual({
      deleted: 0,
      deferred: 1,
    });
    await engine.close();

    engine = new CacheEngine({
      cacheRoot: root,
      limitBytes: 12 * 1024,
      accountInfrastructureBytes: false,
      enforceDiskSafety: false,
    });
    await engine.initialize();

    expect(await engine.acquire(hash(26), namespaceA, 31)).toBeNull();
    expect(engine.getStats().entryCount).toBe(0);
  });

  it('clears only the selected namespace and supports changing the capacity limit', async () => {
    await writeReady(engine, 24, namespaceA, 'owner-a', asset(24));
    await writeReady(engine, 25, namespaceB, 'owner-b', asset(25));

    await expect(engine.clearNamespace(namespaceA)).resolves.toEqual({ deleted: 1, deferred: 0 });
    expect(engine.getNamespaceStats(namespaceA).entryCount).toBe(0);
    expect(engine.getNamespaceStats(namespaceB).entryCount).toBe(1);
    expect(await engine.acquire(hash(25), namespaceB, 40)).not.toBeNull();

    await expect(engine.setLimitBytes(2 * 1024)).resolves.toBeUndefined();
    expect(engine.getLimitBytes()).toBe(2 * 1024);
  });
});

async function writeReady(
  engine: CacheEngine,
  value: number,
  namespaceId: string,
  body: string,
  assetId = asset(value),
) {
  const writeId = await engine.beginWrite({
    keyHash: hash(value),
    namespaceId,
    assetId,
    kind: 'RENDITION',
    expectedLength: Buffer.byteLength(body),
    now: value,
  });
  await engine.append(writeId, Buffer.from(body));
  await engine.commit(writeId, {
    expectedLength: Buffer.byteLength(body),
    contentType: 'image/webp',
    etag: null,
    lastModified: null,
    verifiedAt: value,
    authorizationLeaseUntil: value + 300,
  });
}
