import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertSecureStateDirectory, inventoryOf, requirePat, resolveStateDirectory } from './cli';
import type { MigrationSnapshot } from './snapshot';

test('requires PAT from the environment and never from command arguments', () => {
  assert.throws(() => requirePat({}), /SEKEREAGLE_PAT/);
  assert.throws(() => requirePat({ SEKEREAGLE_PAT: 'se_pat_legacy' }), /SEKEREAGLE_PAT/);
  assert.equal(requirePat({ SEKEREAGLE_PAT: 'sea_pat_example' }), 'sea_pat_example');
});

test('uses a migration-specific local state directory', () => {
  assert.match(
    resolveStateDirectory(undefined, 'migration-1'),
    /sekereagle\/migrations\/migration-1$/,
  );
  assert.equal(resolveStateDirectory('/tmp/custom-state', 'migration-1'), '/tmp/custom-state');
});

test('reports immutable snapshot inventory without exposing item paths', () => {
  const snapshot = {
    header: {
      migrationId: 'migration-1',
      snapshotSha256: 'a'.repeat(64),
      library: { name: 'Library', rootPath: '/Library.library', sourceModifiedAt: 'now' },
      itemCount: 60_000,
      byteSize: 123,
    },
    folders: [{ id: 'folder-1' }],
    tags: [],
    tagGroups: [],
  } as unknown as MigrationSnapshot;

  assert.deepEqual(inventoryOf(snapshot), {
    migrationId: 'migration-1',
    snapshotSha256: 'a'.repeat(64),
    libraryName: 'Library',
    libraryRoot: '/Library.library',
    sourceModifiedAt: 'now',
    itemCount: 60_000,
    byteSize: 123,
    folderCount: 1,
    tagCount: 0,
    tagGroupCount: 0,
  });
});

test('requires the whole SQLite state directory to be private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sekereagle-state-permissions-'));
  const privateDirectory = join(root, 'private');
  const sharedDirectory = join(root, 'shared');
  await mkdir(privateDirectory, { mode: 0o700 });
  await mkdir(sharedDirectory, { mode: 0o755 });
  await assertSecureStateDirectory(privateDirectory);
  await assert.rejects(assertSecureStateDirectory(sharedDirectory), /0700/);
  await chmod(sharedDirectory, 0o700);
  await assertSecureStateDirectory(sharedDirectory);
});
