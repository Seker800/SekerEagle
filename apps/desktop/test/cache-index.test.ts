import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheIndex } from '../src/utility/cache/cache-index';

const namespaceA = 'a'.repeat(64);
const namespaceB = 'b'.repeat(64);
const hash = (value: number) => Buffer.alloc(32, value);

describe('CacheIndex', () => {
  let directory: string;
  let index: CacheIndex;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-index-'));
    index = new CacheIndex(path.join(directory, 'index.sqlite'));
  });

  afterEach(async () => {
    index.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('never exposes interrupted writes as cache hits and recovers them without scanning files', () => {
    index.beginWrite({ keyHash: hash(1), namespaceId: namespaceA, kind: 'RENDITION', now: 10 });

    expect(index.findReady(hash(1))).toBeNull();
    expect(index.recoverInterruptedWrites()).toEqual([hash(1)]);
    expect(index.recoverInterruptedWrites()).toEqual([]);
  });

  it('commits immutable metadata and maintains incremental namespace statistics', () => {
    index.beginWrite({ keyHash: hash(2), namespaceId: namespaceA, kind: 'TILE', now: 20 });
    index.commitReady(hash(2), {
      logicalBytes: 12_345,
      allocatedBytes: 16_384,
      contentType: 'image/webp',
      etag: '"etag-1"',
      lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
      verifiedAt: 21,
      authorizationLeaseUntil: 321,
    });

    expect(index.findReady(hash(2))).toMatchObject({
      namespaceId: namespaceA,
      kind: 'TILE',
      logicalBytes: 12_345,
      allocatedBytes: 16_384,
      segment: 'PROBATION',
      accessCount: 0,
    });
    expect(index.getStats(namespaceA)).toEqual({
      entryCount: 1,
      logicalBytes: 12_345,
      allocatedBytes: 16_384,
    });

    expect(index.deleteEntries([hash(2)])).toEqual({ entries: 1, allocatedBytes: 16_384 });
    expect(index.getStats(namespaceA)).toEqual({
      entryCount: 0,
      logicalBytes: 0,
      allocatedBytes: 0,
    });
  });

  it('batches access updates and promotes a reused probation item', () => {
    for (const value of [3, 4]) {
      index.beginWrite({ keyHash: hash(value), namespaceId: namespaceA, kind: 'RENDITION', now: 1 });
      index.commitReady(hash(value), {
        logicalBytes: 1,
        allocatedBytes: 4_096,
        contentType: 'image/webp',
        etag: null,
        lastModified: null,
        verifiedAt: 1,
        authorizationLeaseUntil: 301,
      });
    }

    index.recordAccesses([
      { keyHash: hash(3), at: 10 },
      { keyHash: hash(3), at: 11 },
      { keyHash: hash(4), at: 12 },
    ]);

    expect(index.findReady(hash(3))).toMatchObject({
      segment: 'PROTECTED',
      accessCount: 2,
      lastAccessAt: 11,
    });
    expect(index.findReady(hash(4))).toMatchObject({
      segment: 'PROTECTED',
      accessCount: 1,
      lastAccessAt: 12,
    });
  });

  it('selects bounded eviction candidates within one namespace and segment', () => {
    for (const [value, namespaceId, now] of [
      [5, namespaceA, 30],
      [6, namespaceA, 10],
      [7, namespaceA, 20],
      [8, namespaceB, 1],
    ] as const) {
      index.beginWrite({ keyHash: hash(value), namespaceId, kind: 'RENDITION', now });
      index.commitReady(hash(value), {
        logicalBytes: 1,
        allocatedBytes: 4_096,
        contentType: 'image/webp',
        etag: null,
        lastModified: null,
        verifiedAt: now,
        authorizationLeaseUntil: now + 300,
      });
    }

    expect(index.listEvictionCandidates(namespaceA, 'PROBATION', 2)).toEqual([hash(6), hash(7)]);
  });

  it('creates a compact WITHOUT ROWID cache table and WAL database', async () => {
    expect(index.inspectSchema()).toMatchObject({ withoutRowid: true, journalMode: 'wal' });
    index.close();
    expect((await readFile(path.join(directory, 'index.sqlite'))).byteLength).toBeGreaterThan(0);
  });
});
