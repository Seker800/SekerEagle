import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheEngine } from '../src/utility/cache/cache-engine';

const namespaceA = 'a'.repeat(64);
const namespaceB = 'b'.repeat(64);
const hash = (value: number) => Buffer.alloc(32, value);

describe('CacheEngine', () => {
  let root: string;
  let engine: CacheEngine;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-engine-'));
    engine = new CacheEngine({ cacheRoot: root, limitBytes: 12 * 1024 });
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
      kind: 'RENDITION',
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
      kind: 'TILE',
      now: 10,
    });
    await expect(
      engine.beginWrite({
        keyHash: hash(2),
        namespaceId: namespaceA,
        kind: 'TILE',
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
      kind: 'RENDITION',
      now: 10,
    });
    await engine.close();

    engine = new CacheEngine({ cacheRoot: root, limitBytes: 12 * 1024 });
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
      kind: 'RENDITION',
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
});

async function writeReady(engine: CacheEngine, value: number, namespaceId: string, body: string) {
  const writeId = await engine.beginWrite({
    keyHash: hash(value),
    namespaceId,
    kind: 'RENDITION',
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
