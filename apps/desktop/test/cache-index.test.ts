import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheIndex } from '../src/utility/cache/cache-index';

const namespaceA = 'a'.repeat(64);
const namespaceB = 'b'.repeat(64);
const hash = (value: number) => Buffer.alloc(32, value);
const asset = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

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
    index.beginWrite({
      keyHash: hash(1),
      namespaceId: namespaceA,
      assetId: asset(1),
      kind: 'RENDITION',
      now: 10,
    });

    expect(index.findReady(hash(1))).toBeNull();
    expect(index.recoverInterruptedWrites()).toEqual([hash(1)]);
    expect(index.recoverInterruptedWrites()).toEqual([]);
  });

  it('commits immutable metadata and maintains incremental namespace statistics', () => {
    index.beginWrite({
      keyHash: hash(2),
      namespaceId: namespaceA,
      assetId: asset(2),
      kind: 'TILE',
      now: 20,
    });
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
      hitCount: 0,
      missCount: 0,
      savedBytes: 0,
    });

    expect(index.deleteEntries([hash(2)])).toEqual({ entries: 1, allocatedBytes: 16_384 });
    expect(index.getStats(namespaceA)).toEqual({
      entryCount: 0,
      logicalBytes: 0,
      allocatedBytes: 0,
      hitCount: 0,
      missCount: 0,
      savedBytes: 0,
    });
  });

  it('batches access updates and promotes a reused probation item', () => {
    for (const value of [3, 4]) {
      index.beginWrite({
        keyHash: hash(value),
        namespaceId: namespaceA,
        assetId: asset(value),
        kind: 'RENDITION',
        now: 1,
      });
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

  it('selects globally oldest bounded eviction candidates', () => {
    for (const [value, namespaceId, now] of [
      [5, namespaceA, 30],
      [6, namespaceA, 10],
      [7, namespaceA, 20],
      [8, namespaceB, 1],
    ] as const) {
      index.beginWrite({
        keyHash: hash(value),
        namespaceId,
        assetId: asset(value),
        kind: 'RENDITION',
        now,
      });
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

    expect(index.listGlobalEvictionCandidates('PROBATION', 2)).toEqual([hash(8), hash(6)]);
  });

  it('creates a compact WITHOUT ROWID cache table and WAL database', async () => {
    expect(index.inspectSchema()).toMatchObject({ withoutRowid: true, journalMode: 'wal' });
    index.close();
    expect((await readFile(path.join(directory, 'index.sqlite'))).byteLength).toBeGreaterThan(0);
  });

  it('uses indexed maintenance plans without a temporary eviction sort', () => {
    const plans = index.inspectMaintenancePlans();

    expect(plans.recovery.join('\n')).toMatch(/SEARCH .*state_idx/iu);
    expect(plans.globalEviction.join('\n')).toMatch(/SEARCH .*global_eviction_idx/iu);
    expect(plans.globalEviction.join('\n')).not.toMatch(/TEMP B-TREE/iu);
  });

  it('recovers an access-table migration interrupted before its completion marker', () => {
    index.beginWrite({
      keyHash: hash(9),
      namespaceId: namespaceA,
      assetId: asset(9),
      kind: 'RENDITION',
      now: 1,
    });
    index.commitReady(hash(9), {
      logicalBytes: 1,
      allocatedBytes: 4_096,
      contentType: 'image/webp',
      etag: null,
      lastModified: null,
      verifiedAt: 1,
      authorizationLeaseUntil: 301,
    });
    index.close();
    const database = new DatabaseSync(path.join(directory, 'index.sqlite'));
    database.exec(`
      DELETE FROM cache_access;
      DELETE FROM cache_schema_migrations WHERE name = 'cache_access_v1';
    `);
    database.close();

    index = new CacheIndex(path.join(directory, 'index.sqlite'));
    expect(index.findReady(hash(9))).toMatchObject({ namespaceId: namespaceA });
  });

  it('renews only an owner-isolated ready entry and supports global eviction ordering', () => {
    for (const value of [10, 11]) {
      index.beginWrite({
        keyHash: hash(value),
        namespaceId: namespaceA,
        assetId: asset(value),
        kind: 'RENDITION',
        now: value,
      });
      index.commitReady(hash(value), {
        logicalBytes: 1,
        allocatedBytes: 4_096,
        contentType: 'image/webp',
        etag: null,
        lastModified: null,
        verifiedAt: value,
        authorizationLeaseUntil: value + 300,
      });
    }

    expect(
      index.renewAuthorization(hash(10), namespaceB, {
        verifiedAt: 20,
        authorizationLeaseUntil: 320,
        etag: '"wrong-owner"',
        lastModified: null,
      }),
    ).toBe(false);
    expect(
      index.renewAuthorization(hash(10), namespaceA, {
        verifiedAt: 20,
        authorizationLeaseUntil: 320,
        etag: '"renewed"',
        lastModified: 'now',
      }),
    ).toBe(true);
    expect(index.findReady(hash(10))).toMatchObject({ etag: '"renewed"', verifiedAt: 20 });
    expect(index.listGlobalEvictionCandidates('PROBATION', 1)).toEqual([hash(10)]);
    expect(index.getTotalStats()).toEqual({
      entryCount: 2,
      logicalBytes: 2,
      allocatedBytes: 8_192,
    });
  });

  it('rejects malformed hashes, namespaces, timestamps, sizes, segments and batches', () => {
    expect(() => index.findReady(Buffer.alloc(31))).toThrow(/hash/);
    expect(() =>
      index.beginWrite({
        keyHash: hash(12),
        namespaceId: 'bad',
        assetId: asset(12),
        kind: 'RENDITION',
        now: 1,
      }),
    ).toThrow(/namespace/);
    expect(() =>
      index.beginWrite({
        keyHash: hash(12),
        namespaceId: namespaceA,
        assetId: asset(12),
        kind: 'RENDITION',
        now: -1,
      }),
    ).toThrow(/时间戳/);
    expect(() => index.listGlobalEvictionCandidates('INVALID' as never, 1)).toThrow(/分段/);
    expect(() => index.listGlobalEvictionCandidates('PROBATION', 0)).toThrow(/批次/);
    expect(index.deleteEntries([])).toEqual({ entries: 0, allocatedBytes: 0 });
    expect(index.getStats(namespaceB)).toEqual({
      entryCount: 0,
      logicalBytes: 0,
      allocatedBytes: 0,
      hitCount: 0,
      missCount: 0,
      savedBytes: 0,
    });
  });
});
