import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MigrationJournal } from './journal';
import { prepareSnapshotForMigration } from './runner';
import type { MigrationSnapshot, SnapshotItem } from './snapshot';

test('builds a server-safe streaming scan and local source index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-runner-'));
  const journal = MigrationJournal.open(join(directory, 'journal.sqlite'), {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
  });
  const items: SnapshotItem[] = [
    {
      sourceItemId: 'item-1',
      sourcePath: '/library/one.jpg',
      contentSha256: 'b'.repeat(64),
      originalFileName: 'one.jpg',
      mimeType: 'image/jpeg',
      size: 3,
    },
    { sourceItemId: 'deleted-1', size: 1, isDeleted: true },
  ];
  const snapshot = {
    header: {
      migrationId: 'migration-1',
      itemCount: 2,
      byteSize: 4,
      library: { name: 'Library', rootPath: '/library', sourceModifiedAt: '2026-08-17T00:00:00Z' },
    },
    folders: [],
    tags: [],
    tagGroups: [],
    iterateItems: async function* () {
      yield* items;
    },
  } as unknown as MigrationSnapshot;

  const prepared = await prepareSnapshotForMigration(snapshot, journal);
  const staged = [];
  for await (const item of prepared.scan.iterateItems()) staged.push(item);

  assert.equal(Object.hasOwn(staged[0]!, 'sourcePath'), false);
  assert.equal((await prepared.sourceFiles.get('item-1'))?.filePath, '/library/one.jpg');
  assert.equal(await prepared.sourceFiles.get('deleted-1'), null);
  assert.equal(journal.get('deleted-1')?.status, 'SKIPPED');
  journal.close();
});
