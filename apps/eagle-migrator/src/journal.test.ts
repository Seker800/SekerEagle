import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MigrationJournal, SnapshotMismatchError } from './journal';

test('persists item checkpoints and recovers interrupted work without losing attempts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-migrator-journal-'));
  const path = join(directory, 'journal.sqlite');
  const journal = MigrationJournal.open(path, {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  });
  journal.registerItems([
    { sourceItemId: 'item-1', contentSha256: 'b'.repeat(64) },
    { sourceItemId: 'item-2', contentSha256: 'c'.repeat(64) },
  ]);
  const claimed = journal.claimReady(1);
  assert.equal(claimed[0]?.sourceItemId, 'item-1');
  journal.markCommitting('item-1', { uploadSessionId: 'upload-1' });
  journal.close();

  const restored = MigrationJournal.open(path, {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  });
  assert.equal(restored.recoverInterrupted(), 1);
  assert.deepEqual(restored.summary(), {
    READY: 1,
    RETRYABLE: 1,
    total: 2,
  });
  const retry = restored.claimReady(1)[0];
  assert.equal(retry?.sourceItemId, 'item-1');
  assert.equal(retry?.attemptCount, 2);
  restored.markImported('item-1', { assetId: 'asset-1', duplicate: false });
  assert.equal(restored.get('item-1')?.status, 'IMPORTED');
  restored.close();
});

test('refuses to reuse a journal for a different immutable snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-migrator-journal-mismatch-'));
  const path = join(directory, 'journal.sqlite');
  MigrationJournal.open(path, {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  }).close();

  assert.throws(
    () =>
      MigrationJournal.open(path, {
        migrationId: 'migration-1',
        snapshotSha256: 'b'.repeat(64),
      }),
    SnapshotMismatchError,
  );
});

test('records bounded errors but never accepts bearer tokens as persisted fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-migrator-journal-secret-'));
  const path = join(directory, 'journal.sqlite');
  const journal = MigrationJournal.open(path, {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  });
  journal.registerItems([{ sourceItemId: 'item-1', contentSha256: 'b'.repeat(64) }]);
  journal.markRetryable('item-1', {
    code: 'NETWORK_ERROR',
    message: `request failed with Authorization: Bearer se_pat_${'x'.repeat(64)}`,
  });
  const item = journal.get('item-1');
  assert.doesNotMatch(item?.lastErrorMessage ?? '', /se_pat_|Bearer/i);
  assert.ok((item?.lastErrorMessage.length ?? 0) <= 500);
  journal.close();
});

test('tracks a specific server-scheduled item and preserves explicit skips', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-migrator-journal-item-'));
  const journal = MigrationJournal.open(join(directory, 'journal.sqlite'), {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  });
  journal.registerItems([
    { sourceItemId: 'item-1', contentSha256: 'b'.repeat(64) },
    { sourceItemId: 'item-2', contentSha256: 'c'.repeat(64) },
  ]);

  journal.markUploading('item-2');
  journal.markSkipped('item-1', { code: 'SKIP_DELETED', message: 'Eagle trash record' });

  assert.equal(journal.get('item-2')?.attemptCount, 1);
  assert.equal(journal.get('item-2')?.status, 'UPLOADING');
  assert.equal(journal.get('item-1')?.status, 'SKIPPED');
  journal.close();
});
