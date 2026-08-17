import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createItemReporter } from './item-reporter';
import { MigrationJournal } from './journal';

function journalFixture(directory: string) {
  const journal = MigrationJournal.open(join(directory, 'journal.sqlite'), {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  });
  journal.registerItems([{ sourceItemId: 'item-1', contentSha256: 'b'.repeat(64) }]);
  return journal;
}

test('projects upload lifecycle events into the local journal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-reporter-'));
  const journal = journalFixture(directory);
  const report = createItemReporter(journal);

  await report({ sourceItemId: 'item-1' }, { status: 'UPLOADING' });
  await report(
    { sourceItemId: 'item-1' },
    { status: 'COMMITTING', uploadSessionId: 'upload-1' },
  );
  await report(
    { sourceItemId: 'item-1' },
    { status: 'IMPORTED', assetId: 'asset-1', duplicate: false },
  );

  assert.equal(journal.get('item-1')?.status, 'IMPORTED');
  assert.equal(journal.get('item-1')?.assetId, 'asset-1');
  journal.close();
});

test('separates transient failures from permanent content rejection', async () => {
  const transientDirectory = await mkdtemp(join(tmpdir(), 'sekereagle-reporter-transient-'));
  const transient = journalFixture(transientDirectory);
  const transientReport = createItemReporter(transient);
  await transientReport(
    { sourceItemId: 'item-1' },
    { status: 'FAILED', error: { status: 503, message: 'temporarily unavailable' } },
  );
  assert.equal(transient.get('item-1')?.status, 'RETRYABLE');
  transient.close();

  const permanentDirectory = await mkdtemp(join(tmpdir(), 'sekereagle-reporter-permanent-'));
  const permanent = journalFixture(permanentDirectory);
  const permanentReport = createItemReporter(permanent);
  await permanentReport(
    { sourceItemId: 'item-1' },
    {
      status: 'FAILED',
      error: { status: 400, code: 'CONTENT_HASH_MISMATCH', message: 'content mismatch' },
    },
  );
  assert.equal(permanent.get('item-1')?.status, 'REJECTED');
  permanent.close();
});

