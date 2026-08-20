import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type CacheKind = 'RENDITION' | 'TILE';
export type CacheSegment = 'PROBATION' | 'PROTECTED';

export interface ReadyCacheEntry {
  namespaceId: string;
  assetId: string;
  kind: CacheKind;
  logicalBytes: number;
  allocatedBytes: number;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  segment: CacheSegment;
  accessCount: number;
  lastAccessAt: number;
  verifiedAt: number;
  authorizationLeaseUntil: number;
}

interface CacheEntryRow {
  namespace_id: string;
  asset_id: string;
  kind: CacheKind;
  logical_bytes: number;
  allocated_bytes: number;
  content_type: string;
  etag: string | null;
  last_modified: string | null;
  segment: CacheSegment;
  access_count: number;
  last_access_at: number;
  verified_at: number;
  authorization_lease_until: number;
}

const NAMESPACE_ID = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class CacheIndex {
  private readonly database: DatabaseSync;
  private readonly beginWriteStatement: StatementSync;
  private readonly commitReadyStatement: StatementSync;
  private readonly namespaceStatement: StatementSync;
  private readonly statsUpsertStatement: StatementSync;
  private readonly findReadyStatement: StatementSync;
  private readonly recordAccessStatement: StatementSync;
  private closed = false;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE IF NOT EXISTS cache_entries (
        key_hash BLOB PRIMARY KEY CHECK(length(key_hash) = 32),
        namespace_id TEXT NOT NULL CHECK(length(namespace_id) = 64),
        asset_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('RENDITION', 'TILE')),
        state TEXT NOT NULL CHECK(state IN ('WRITING', 'READY')),
        logical_bytes INTEGER NOT NULL DEFAULT 0 CHECK(logical_bytes >= 0),
        allocated_bytes INTEGER NOT NULL DEFAULT 0 CHECK(allocated_bytes >= 0),
        content_type TEXT,
        etag TEXT,
        last_modified TEXT,
        segment TEXT NOT NULL DEFAULT 'PROBATION' CHECK(segment IN ('PROBATION', 'PROTECTED')),
        access_count INTEGER NOT NULL DEFAULT 0 CHECK(access_count >= 0),
        last_access_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        verified_at INTEGER NOT NULL DEFAULT 0,
        authorization_lease_until INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS cache_entries_eviction_idx
        ON cache_entries(namespace_id, state, segment, last_access_at, created_at);

      CREATE INDEX IF NOT EXISTS cache_entries_asset_idx
        ON cache_entries(namespace_id, asset_id, state);

      CREATE TABLE IF NOT EXISTS cache_stats (
        namespace_id TEXT PRIMARY KEY CHECK(length(namespace_id) = 64),
        entry_count INTEGER NOT NULL DEFAULT 0 CHECK(entry_count >= 0),
        logical_bytes INTEGER NOT NULL DEFAULT 0 CHECK(logical_bytes >= 0),
        allocated_bytes INTEGER NOT NULL DEFAULT 0 CHECK(allocated_bytes >= 0)
        ,hit_count INTEGER NOT NULL DEFAULT 0 CHECK(hit_count >= 0)
        ,miss_count INTEGER NOT NULL DEFAULT 0 CHECK(miss_count >= 0)
        ,saved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(saved_bytes >= 0)
      ) WITHOUT ROWID;
    `);
    this.beginWriteStatement = this.database.prepare(
      `INSERT INTO cache_entries (
        key_hash, namespace_id, asset_id, kind, state, last_access_at, created_at
      ) VALUES (?, ?, ?, ?, 'WRITING', ?, ?)`,
    );
    this.commitReadyStatement = this.database.prepare(
      `UPDATE cache_entries
       SET state = 'READY', logical_bytes = ?, allocated_bytes = ?, content_type = ?,
           etag = ?, last_modified = ?, verified_at = ?, authorization_lease_until = ?
       WHERE key_hash = ? AND state = 'WRITING'`,
    );
    this.namespaceStatement = this.database.prepare(
      'SELECT namespace_id FROM cache_entries WHERE key_hash = ?',
    );
    this.statsUpsertStatement = this.database.prepare(
      `INSERT INTO cache_stats(namespace_id, entry_count, logical_bytes, allocated_bytes)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(namespace_id) DO UPDATE SET
         entry_count = entry_count + 1,
         logical_bytes = logical_bytes + excluded.logical_bytes,
         allocated_bytes = allocated_bytes + excluded.allocated_bytes`,
    );
    this.findReadyStatement = this.database.prepare(
      `SELECT namespace_id, asset_id, kind, logical_bytes, allocated_bytes, content_type, etag,
              last_modified, segment, access_count, last_access_at, verified_at,
              authorization_lease_until
       FROM cache_entries WHERE key_hash = ? AND state = 'READY'`,
    );
    this.recordAccessStatement = this.database.prepare(
      `UPDATE cache_entries
       SET access_count = access_count + ?, last_access_at = ?, segment = 'PROTECTED'
       WHERE key_hash = ? AND state = 'READY'`,
    );
  }

  beginWrite(input: {
    keyHash: Buffer;
    namespaceId: string;
    assetId: string;
    kind: CacheKind;
    now: number;
  }): void {
    assertHash(input.keyHash);
    assertNamespace(input.namespaceId);
    assertAssetId(input.assetId);
    assertTimestamp(input.now);
    const result = this.beginWriteStatement.run(
      input.keyHash,
      input.namespaceId,
      input.assetId,
      input.kind,
      input.now,
      input.now,
    );
    if (result.changes !== 1) throw new Error('无法建立缓存写入状态。');
  }

  commitReady(
    keyHash: Buffer,
    input: {
      logicalBytes: number;
      allocatedBytes: number;
      contentType: string;
      etag: string | null;
      lastModified: string | null;
      verifiedAt: number;
      authorizationLeaseUntil: number;
    },
  ): void {
    assertHash(keyHash);
    assertByteSize(input.logicalBytes);
    assertByteSize(input.allocatedBytes);
    assertTimestamp(input.verifiedAt);
    assertTimestamp(input.authorizationLeaseUntil);
    if (!input.contentType || input.contentType.length > 255) throw new Error('媒体类型无效。');

    this.transaction(() => {
      const result = this.commitReadyStatement.run(
        input.logicalBytes,
        input.allocatedBytes,
        input.contentType,
        input.etag,
        input.lastModified,
        input.verifiedAt,
        input.authorizationLeaseUntil,
        keyHash,
      );
      if (result.changes !== 1) throw new Error('缓存写入状态不存在或已经提交。');
      const row = this.getNamespace(keyHash);
      this.statsUpsertStatement.run(row.namespace_id, input.logicalBytes, input.allocatedBytes);
    });
  }

  findReady(keyHash: Buffer): ReadyCacheEntry | null {
    assertHash(keyHash);
    const row = this.findReadyStatement.get(keyHash) as CacheEntryRow | undefined;
    if (!row) return null;
    return {
      namespaceId: row.namespace_id,
      assetId: row.asset_id,
      kind: row.kind,
      logicalBytes: row.logical_bytes,
      allocatedBytes: row.allocated_bytes,
      contentType: row.content_type,
      etag: row.etag,
      lastModified: row.last_modified,
      segment: row.segment,
      accessCount: row.access_count,
      lastAccessAt: row.last_access_at,
      verifiedAt: row.verified_at,
      authorizationLeaseUntil: row.authorization_lease_until,
    };
  }

  recordAccesses(accesses: ReadonlyArray<{ keyHash: Buffer; at: number }>): void {
    const grouped = new Map<string, { keyHash: Buffer; count: number; at: number }>();
    for (const access of accesses) {
      assertHash(access.keyHash);
      assertTimestamp(access.at);
      const id = access.keyHash.toString('hex');
      const existing = grouped.get(id);
      if (existing) {
        existing.count += 1;
        existing.at = Math.max(existing.at, access.at);
      } else {
        grouped.set(id, { keyHash: access.keyHash, count: 1, at: access.at });
      }
    }
    if (!grouped.size) return;

    this.transaction(() => {
      for (const access of grouped.values()) {
        this.recordAccessStatement.run(access.count, access.at, access.keyHash);
      }
    });
  }

  recordMetrics(
    metrics: ReadonlyArray<{
      namespaceId: string;
      hitCount: number;
      missCount: number;
      savedBytes: number;
    }>,
  ): void {
    if (!metrics.length) return;
    const update = this.database.prepare(
      `INSERT INTO cache_stats(
         namespace_id, entry_count, logical_bytes, allocated_bytes,
         hit_count, miss_count, saved_bytes
       ) VALUES (?, 0, 0, 0, ?, ?, ?)
       ON CONFLICT(namespace_id) DO UPDATE SET
         hit_count = hit_count + excluded.hit_count,
         miss_count = miss_count + excluded.miss_count,
         saved_bytes = saved_bytes + excluded.saved_bytes`,
    );
    this.transaction(() => {
      for (const metric of metrics) {
        assertNamespace(metric.namespaceId);
        assertByteSize(metric.hitCount);
        assertByteSize(metric.missCount);
        assertByteSize(metric.savedBytes);
        update.run(metric.namespaceId, metric.hitCount, metric.missCount, metric.savedBytes);
      }
    });
  }

  listEvictionCandidates(namespaceId: string, segment: CacheSegment, limit: number): Buffer[] {
    assertNamespace(namespaceId);
    if (segment !== 'PROBATION' && segment !== 'PROTECTED') throw new Error('缓存分段无效。');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error('淘汰批次无效。');
    }
    const rows = this.database
      .prepare(
        `SELECT key_hash FROM cache_entries
         WHERE namespace_id = ? AND state = 'READY' AND segment = ?
         ORDER BY last_access_at ASC, created_at ASC
         LIMIT ?`,
      )
      .all(namespaceId, segment, limit) as Array<{ key_hash: Uint8Array }>;
    return rows.map(({ key_hash }) => Buffer.from(key_hash));
  }

  deleteEntries(keyHashes: readonly Buffer[]): { entries: number; allocatedBytes: number } {
    if (!keyHashes.length) return { entries: 0, allocatedBytes: 0 };
    const select = this.database.prepare(
      `SELECT namespace_id, logical_bytes, allocated_bytes
       FROM cache_entries WHERE key_hash = ? AND state = 'READY'`,
    );
    const remove = this.database.prepare('DELETE FROM cache_entries WHERE key_hash = ?');
    const adjust = this.database.prepare(
      `UPDATE cache_stats SET
         entry_count = MAX(0, entry_count - 1),
         logical_bytes = MAX(0, logical_bytes - ?),
         allocated_bytes = MAX(0, allocated_bytes - ?)
       WHERE namespace_id = ?`,
    );
    let entries = 0;
    let allocatedBytes = 0;
    this.transaction(() => {
      for (const keyHash of keyHashes) {
        assertHash(keyHash);
        const row = select.get(keyHash) as
          { namespace_id: string; logical_bytes: number; allocated_bytes: number } | undefined;
        if (!row) continue;
        remove.run(keyHash);
        adjust.run(row.logical_bytes, row.allocated_bytes, row.namespace_id);
        entries += 1;
        allocatedBytes += row.allocated_bytes;
      }
    });
    return { entries, allocatedBytes };
  }

  discardWriting(keyHash: Buffer): boolean {
    assertHash(keyHash);
    return (
      this.database
        .prepare(`DELETE FROM cache_entries WHERE key_hash = ? AND state = 'WRITING'`)
        .run(keyHash).changes === 1
    );
  }

  renewAuthorization(
    keyHash: Buffer,
    namespaceId: string,
    input: {
      verifiedAt: number;
      authorizationLeaseUntil: number;
      etag: string | null;
      lastModified: string | null;
    },
  ): boolean {
    assertHash(keyHash);
    assertNamespace(namespaceId);
    assertTimestamp(input.verifiedAt);
    assertTimestamp(input.authorizationLeaseUntil);
    return (
      this.database
        .prepare(
          `UPDATE cache_entries SET
             verified_at = ?, authorization_lease_until = ?,
             etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified)
           WHERE key_hash = ? AND namespace_id = ? AND state = 'READY'`,
        )
        .run(
          input.verifiedAt,
          input.authorizationLeaseUntil,
          input.etag,
          input.lastModified,
          keyHash,
          namespaceId,
        ).changes === 1
    );
  }

  listGlobalEvictionCandidates(segment: CacheSegment, limit: number): Buffer[] {
    if (segment !== 'PROBATION' && segment !== 'PROTECTED') throw new Error('缓存分段无效。');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error('淘汰批次无效。');
    }
    const rows = this.database
      .prepare(
        `SELECT key_hash FROM cache_entries
         WHERE state = 'READY' AND segment = ?
         ORDER BY last_access_at ASC, created_at ASC
         LIMIT ?`,
      )
      .all(segment, limit) as Array<{ key_hash: Uint8Array }>;
    return rows.map(({ key_hash }) => Buffer.from(key_hash));
  }

  listAssetEntries(namespaceId: string, assetId: string): Buffer[] {
    assertNamespace(namespaceId);
    assertAssetId(assetId);
    return this.listHashes(
      `SELECT key_hash FROM cache_entries
       WHERE namespace_id = ? AND asset_id = ? AND state = 'READY'`,
      namespaceId,
      assetId,
    );
  }

  listNamespaceEntries(namespaceId: string): Buffer[] {
    assertNamespace(namespaceId);
    return this.listHashes(
      `SELECT key_hash FROM cache_entries WHERE namespace_id = ? AND state = 'READY'`,
      namespaceId,
    );
  }

  recoverInterruptedWrites(): Buffer[] {
    const rows = this.database
      .prepare(`SELECT key_hash FROM cache_entries WHERE state = 'WRITING'`)
      .all() as Array<{
      key_hash: Uint8Array;
    }>;
    if (rows.length) this.database.exec(`DELETE FROM cache_entries WHERE state = 'WRITING'`);
    return rows.map(({ key_hash }) => Buffer.from(key_hash));
  }

  getStats(namespaceId: string): {
    entryCount: number;
    logicalBytes: number;
    allocatedBytes: number;
    hitCount: number;
    missCount: number;
    savedBytes: number;
  } {
    assertNamespace(namespaceId);
    const row = this.database
      .prepare(
        `SELECT entry_count, logical_bytes, allocated_bytes, hit_count, miss_count, saved_bytes
         FROM cache_stats WHERE namespace_id = ?`,
      )
      .get(namespaceId) as
      | {
          entry_count: number;
          logical_bytes: number;
          allocated_bytes: number;
          hit_count: number;
          miss_count: number;
          saved_bytes: number;
        }
      | undefined;
    return {
      entryCount: row?.entry_count ?? 0,
      logicalBytes: row?.logical_bytes ?? 0,
      allocatedBytes: row?.allocated_bytes ?? 0,
      hitCount: row?.hit_count ?? 0,
      missCount: row?.miss_count ?? 0,
      savedBytes: row?.saved_bytes ?? 0,
    };
  }

  getTotalStats(): { entryCount: number; logicalBytes: number; allocatedBytes: number } {
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(entry_count), 0) AS entry_count,
                COALESCE(SUM(logical_bytes), 0) AS logical_bytes,
                COALESCE(SUM(allocated_bytes), 0) AS allocated_bytes
         FROM cache_stats`,
      )
      .get() as { entry_count: number; logical_bytes: number; allocated_bytes: number };
    return {
      entryCount: row.entry_count,
      logicalBytes: row.logical_bytes,
      allocatedBytes: row.allocated_bytes,
    };
  }

  inspectSchema(): { withoutRowid: boolean; journalMode: string } {
    const table = this.database
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cache_entries'`)
      .get() as { sql: string };
    const journal = this.database.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    return { withoutRowid: /WITHOUT ROWID/iu.test(table.sql), journalMode: journal.journal_mode };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private getNamespace(keyHash: Buffer): { namespace_id: string } {
    const row = this.namespaceStatement.get(keyHash) as { namespace_id: string } | undefined;
    if (!row) throw new Error('缓存条目不存在。');
    return row;
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private listHashes(sql: string, ...params: string[]): Buffer[] {
    const rows = this.database.prepare(sql).all(...params) as Array<{ key_hash: Uint8Array }>;
    return rows.map(({ key_hash }) => Buffer.from(key_hash));
  }
}

function assertHash(value: Buffer): void {
  if (!Buffer.isBuffer(value) || value.byteLength !== 32) throw new Error('缓存 key hash 无效。');
}

function assertNamespace(value: string): void {
  if (!NAMESPACE_ID.test(value)) throw new Error('缓存 namespace 无效。');
}

function assertAssetId(value: string): void {
  if (!UUID.test(value)) throw new Error('缓存 assetId 无效。');
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('缓存时间戳无效。');
}

function assertByteSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('缓存字节数无效。');
}
