import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { redactSensitiveText } from './secrets';

export type MigrationItemStatus =
  'READY' | 'UPLOADING' | 'COMMITTING' | 'RETRYABLE' | 'IMPORTED' | 'SKIPPED' | 'REJECTED';

export interface JournalIdentity {
  migrationId: string;
  snapshotSha256: string;
}

export interface ActiveRunState {
  runId: string;
  phase: string;
  libraryPath: string;
  externalLibraryId?: string;
}

export interface JournalItem {
  sourceItemId: string;
  contentSha256: string;
  status: MigrationItemStatus;
  attemptCount: number;
  uploadSessionId: string | null;
  assetId: string | null;
  duplicate: boolean | null;
  lastErrorCode: string | null;
  lastErrorMessage: string;
}

interface JournalItemRow {
  sourceItemId: string;
  contentSha256: string;
  status: MigrationItemStatus;
  attemptCount: number;
  uploadSessionId: string | null;
  assetId: string | null;
  duplicate: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export class SnapshotMismatchError extends Error {
  constructor() {
    super('本地迁移 journal 属于另一个不可变快照，已拒绝复用。');
    this.name = 'SnapshotMismatchError';
  }
}

export class MigrationJournal {
  private constructor(private readonly database: DatabaseSync) {}

  static open(path: string, identity: JournalIdentity): MigrationJournal {
    assertIdentity(identity);
    const database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    database.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;',
    );
    database.exec(`
      CREATE TABLE IF NOT EXISTS migration_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS migration_items (
        source_item_id TEXT PRIMARY KEY,
        content_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('READY','UPLOADING','COMMITTING','RETRYABLE','IMPORTED','SKIPPED','REJECTED')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        upload_session_id TEXT,
        asset_id TEXT,
        duplicate INTEGER,
        last_error_code TEXT,
        last_error_message TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS migration_items_status_idx
      ON migration_items(status, source_item_id);
    `);
    const journal = new MigrationJournal(database);
    try {
      journal.bindIdentity(identity);
      return journal;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  loadActiveRun(): ActiveRunState | null {
    const row = this.database
      .prepare("SELECT value FROM migration_metadata WHERE key = 'activeRun'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    return parseActiveRun(JSON.parse(row.value));
  }

  loadServerRunId(): string | null {
    const row = this.database
      .prepare("SELECT value FROM migration_metadata WHERE key = 'lastServerRunId'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  saveActiveRun(value: unknown): void {
    if (value === null) {
      this.database.prepare("DELETE FROM migration_metadata WHERE key = 'activeRun'").run();
      return;
    }
    const activeRun = parseActiveRun(value);
    const upsert = this.database.prepare(`
      INSERT INTO migration_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    this.transaction(() => {
      upsert.run('activeRun', JSON.stringify(activeRun));
      upsert.run('lastServerRunId', activeRun.runId);
    });
  }

  registerItems(items: Iterable<{ sourceItemId: string; contentSha256: string }>): void {
    const statement = this.database.prepare(`
      INSERT INTO migration_items (
        source_item_id, content_sha256, status, updated_at
      ) VALUES (?, ?, 'READY', ?)
      ON CONFLICT(source_item_id) DO UPDATE SET
        content_sha256 = excluded.content_sha256,
        status = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.status ELSE 'READY' END,
        attempt_count = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.attempt_count ELSE 0 END,
        upload_session_id = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.upload_session_id ELSE NULL END,
        asset_id = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.asset_id ELSE NULL END,
        duplicate = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.duplicate ELSE NULL END,
        last_error_code = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.last_error_code ELSE NULL END,
        last_error_message = CASE
          WHEN migration_items.content_sha256 = excluded.content_sha256
          THEN migration_items.last_error_message ELSE NULL END,
        updated_at = excluded.updated_at
    `);
    this.transaction(() => {
      for (const item of items) {
        assertSourceItem(item.sourceItemId, item.contentSha256);
        statement.run(item.sourceItemId, item.contentSha256.toLowerCase(), now());
      }
    });
  }

  claimReady(limit: number): JournalItem[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return this.transaction(() => {
      const rows = this.database
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM migration_items
           WHERE status IN ('RETRYABLE', 'READY')
           ORDER BY CASE status WHEN 'RETRYABLE' THEN 0 ELSE 1 END, source_item_id
           LIMIT ?`,
        )
        .all(boundedLimit) as unknown as JournalItemRow[];
      const update = this.database.prepare(`
        UPDATE migration_items SET
          status = 'UPLOADING', attempt_count = attempt_count + 1,
          last_error_code = NULL, last_error_message = NULL, updated_at = ?
        WHERE source_item_id = ? AND status IN ('READY', 'RETRYABLE')
      `);
      const claimed: JournalItem[] = [];
      for (const row of rows) {
        const result = update.run(now(), row.sourceItemId);
        if (result.changes === 1) {
          claimed.push({
            ...serializeRow(row),
            status: 'UPLOADING',
            attemptCount: row.attemptCount + 1,
          });
        }
      }
      return claimed;
    });
  }

  markCommitting(sourceItemId: string, input: { uploadSessionId: string }): void {
    this.transition(sourceItemId, ['UPLOADING'], 'COMMITTING', {
      uploadSessionId: input.uploadSessionId,
    });
  }

  markUploading(sourceItemId: string): void {
    const result = this.database
      .prepare(
        `
        UPDATE migration_items SET
          status = 'UPLOADING', attempt_count = attempt_count + 1,
          last_error_code = NULL, last_error_message = NULL, updated_at = ?
        WHERE source_item_id = ? AND status IN ('READY', 'RETRYABLE', 'UPLOADING')
      `,
      )
      .run(now(), sourceItemId);
    if (result.changes !== 1) throw new Error(`迁移项 ${sourceItemId} 当前不能上传。`);
  }

  markImported(sourceItemId: string, input: { assetId: string; duplicate: boolean }): void {
    const result = this.database
      .prepare(
        `
        UPDATE migration_items SET
          status = 'IMPORTED', asset_id = ?, duplicate = ?, upload_session_id = NULL,
          last_error_code = NULL, last_error_message = NULL, updated_at = ?
        WHERE source_item_id = ? AND status IN ('UPLOADING', 'COMMITTING')
      `,
      )
      .run(input.assetId, input.duplicate ? 1 : 0, now(), sourceItemId);
    if (result.changes !== 1) throw new Error(`迁移项 ${sourceItemId} 不能标记为 IMPORTED。`);
  }

  reconcileImported(sourceItemId: string, input: { assetId: string; duplicate?: boolean }): void {
    const result = this.database
      .prepare(
        `
        UPDATE migration_items SET
          status = 'IMPORTED', asset_id = ?, duplicate = ?, upload_session_id = NULL,
          last_error_code = NULL, last_error_message = NULL, updated_at = ?
        WHERE source_item_id = ? AND status NOT IN ('REJECTED')
      `,
      )
      .run(input.assetId, input.duplicate ? 1 : 0, now(), sourceItemId);
    if (result.changes !== 1) throw new Error(`迁移项 ${sourceItemId} 无法与服务端完成状态收敛。`);
  }

  markRetryable(sourceItemId: string, error: { code: string; message: unknown }): void {
    this.markFailed(sourceItemId, 'RETRYABLE', error);
  }

  markRejected(sourceItemId: string, error: { code: string; message: unknown }): void {
    this.markFailed(sourceItemId, 'REJECTED', error);
  }

  markSkipped(sourceItemId: string, error: { code: string; message: unknown }): void {
    const current = this.get(sourceItemId);
    if (current?.status === 'SKIPPED') return;
    this.markFailed(sourceItemId, 'SKIPPED', error);
  }

  recoverInterrupted(): number {
    const result = this.database
      .prepare(
        `
        UPDATE migration_items SET status = 'RETRYABLE', updated_at = ?
        WHERE status IN ('UPLOADING', 'COMMITTING')
      `,
      )
      .run(now());
    return Number(result.changes);
  }

  get(sourceItemId: string): JournalItem | null {
    const row = this.database
      .prepare(`SELECT ${SELECT_COLUMNS} FROM migration_items WHERE source_item_id = ?`)
      .get(sourceItemId) as unknown as JournalItemRow | undefined;
    return row ? serializeRow(row) : null;
  }

  summary(): Record<string, number> {
    const rows = this.database
      .prepare('SELECT status, count(*) AS count FROM migration_items GROUP BY status')
      .all() as unknown as Array<{ status: MigrationItemStatus; count: number }>;
    const result: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      result[row.status] = row.count;
      total += row.count;
    }
    result.total = total;
    return result;
  }

  private bindIdentity(identity: JournalIdentity): void {
    const select = this.database.prepare('SELECT value FROM migration_metadata WHERE key = ?');
    const insert = this.database.prepare(
      'INSERT INTO migration_metadata (key, value) VALUES (?, ?)',
    );
    this.transaction(() => {
      for (const [key, value] of Object.entries(identity) as Array<[string, string]>) {
        const existing = select.get(key) as { value: string } | undefined;
        if (existing && existing.value !== value) throw new SnapshotMismatchError();
        if (!existing) insert.run(key, value);
      }
    });
  }

  private transition(
    sourceItemId: string,
    from: MigrationItemStatus[],
    to: MigrationItemStatus,
    values: { uploadSessionId?: string | null; assetId?: string; duplicate?: number },
  ): void {
    const placeholders = from.map(() => '?').join(',');
    const result = this.database
      .prepare(
        `
        UPDATE migration_items SET
          status = ?, upload_session_id = COALESCE(?, upload_session_id),
          asset_id = COALESCE(?, asset_id), duplicate = COALESCE(?, duplicate),
          updated_at = ?
        WHERE source_item_id = ? AND status IN (${placeholders})
      `,
      )
      .run(
        to,
        values.uploadSessionId ?? null,
        values.assetId ?? null,
        values.duplicate ?? null,
        now(),
        sourceItemId,
        ...from,
      );
    if (result.changes !== 1) throw new Error(`迁移项 ${sourceItemId} 不能从当前状态转为 ${to}。`);
  }

  private markFailed(
    sourceItemId: string,
    status: 'RETRYABLE' | 'SKIPPED' | 'REJECTED',
    error: { code: string; message: unknown },
  ): void {
    const result = this.database
      .prepare(
        `
        UPDATE migration_items SET
          status = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
        WHERE source_item_id = ? AND status NOT IN ('IMPORTED', 'SKIPPED', 'REJECTED')
      `,
      )
      .run(
        status,
        redactSensitiveText(error.code, 64),
        redactSensitiveText(error.message),
        now(),
        sourceItemId,
      );
    if (result.changes !== 1) throw new Error(`迁移项 ${sourceItemId} 不能标记为 ${status}。`);
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const SELECT_COLUMNS = `
  source_item_id AS sourceItemId,
  content_sha256 AS contentSha256,
  status,
  attempt_count AS attemptCount,
  upload_session_id AS uploadSessionId,
  asset_id AS assetId,
  duplicate,
  last_error_code AS lastErrorCode,
  last_error_message AS lastErrorMessage
`;

function serializeRow(row: JournalItemRow): JournalItem {
  return {
    ...row,
    duplicate: row.duplicate === null ? null : row.duplicate === 1,
    lastErrorMessage: row.lastErrorMessage ?? '',
  };
}

function assertIdentity(identity: JournalIdentity): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identity.migrationId)) {
    throw new Error('migrationId 无效。');
  }
  if (!/^[a-f0-9]{64}$/i.test(identity.snapshotSha256)) {
    throw new Error('snapshotSha256 无效。');
  }
}

function assertSourceItem(sourceItemId: string, contentSha256: string): void {
  if (!sourceItemId || sourceItemId.length > 255) throw new Error('sourceItemId 无效。');
  if (!/^[a-f0-9]{64}$/i.test(contentSha256)) throw new Error('contentSha256 无效。');
}

function parseActiveRun(value: unknown): ActiveRunState {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('active run control state 无效。');
  }
  const record = value as Record<string, unknown>;
  const forbidden = Object.keys(record).find((key) =>
    /token|secret|password|authorization|cookie/i.test(key),
  );
  if (forbidden) throw new Error(`active run control state 不得包含 secret 字段：${forbidden}`);
  const runId = stringField(record.runId);
  const phase = stringField(record.phase);
  const libraryPath = stringField(record.libraryPath);
  const externalLibraryId = stringField(record.externalLibraryId) || undefined;
  if (!runId || !phase || !libraryPath) throw new Error('active run control state 缺少必要字段。');
  return { runId, phase, libraryPath, ...(externalLibraryId ? { externalLibraryId } : {}) };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function now(): string {
  return new Date().toISOString();
}
