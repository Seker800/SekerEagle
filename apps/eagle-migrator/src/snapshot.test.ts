import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SnapshotIntegrityError, openMigrationSnapshot } from './snapshot';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sekereagle-migrator-snapshot-'));
  const library = join(root, 'Library.library');
  const snapshot = join(root, 'snapshot');
  await mkdir(join(library, 'images'), { recursive: true });
  const imagePath = join(library, 'images', 'one.jpg');
  await writeFile(imagePath, 'one');
  await mkdir(snapshot);
  await writeFile(
    join(snapshot, 'snapshot.json'),
    JSON.stringify({
      formatVersion: 1,
      migrationId: 'migration-1',
      library: { name: 'Library', rootPath: library, sourceModifiedAt: '2026-08-17T00:00:00.000Z' },
      itemCount: 1,
      byteSize: 3,
      files: {
        items: { path: 'items.ndjson', sha256: '' },
        folders: { path: 'folders.json', sha256: '' },
        tags: { path: 'tags.json', sha256: '' },
        tagGroups: { path: 'tag-groups.json', sha256: '' },
      },
    }),
  );
  await writeFile(
    join(snapshot, 'items.ndjson'),
    `${JSON.stringify({
      sourceItemId: 'item-1',
      name: 'One',
      originalFileName: 'one.jpg',
      extension: 'jpg',
      mimeType: 'image/jpeg',
      size: 3,
      contentSha256: '7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed',
      sourceFileModifiedAt: 1,
      sourcePath: imagePath,
      importedAt: 1,
      modifiedAt: 1,
      star: 0,
      annotation: '',
      sourceUrl: '',
      tagNames: [],
      folderIds: [],
      isDeleted: false,
    })}\n`,
  );
  await writeFile(join(snapshot, 'folders.json'), '[]\n');
  await writeFile(join(snapshot, 'tags.json'), '[]\n');
  await writeFile(join(snapshot, 'tag-groups.json'), '[]\n');
  return { root, library, snapshot, imagePath };
}

test('opens a checksummed immutable snapshot and streams its items', async () => {
  const value = await fixture();
  const snapshot = await openMigrationSnapshot(value.snapshot, { repairMissingChecksums: true });

  assert.equal(snapshot.header.itemCount, 1);
  assert.equal(snapshot.header.byteSize, 3);
  assert.equal(snapshot.header.snapshotSha256.length, 64);
  const items = [];
  for await (const item of snapshot.iterateItems()) items.push(item);
  assert.equal(items[0]?.sourceItemId, 'item-1');
  assert.equal(await snapshot.sourceFiles.get('item-1'), value.imagePath);

  const persisted = JSON.parse(await readFile(join(value.snapshot, 'snapshot.json'), 'utf8'));
  assert.equal(persisted.files.items.sha256.length, 64);
});

test('fails closed when a checksummed manifest is modified', async () => {
  const value = await fixture();
  await openMigrationSnapshot(value.snapshot, { repairMissingChecksums: true });
  await writeFile(join(value.snapshot, 'items.ndjson'), '{}\n');

  await assert.rejects(openMigrationSnapshot(value.snapshot), SnapshotIntegrityError);
});

test('rejects source paths outside the frozen library and symlink escapes', async () => {
  const value = await fixture();
  const outside = join(value.root, 'outside.jpg');
  await writeFile(outside, 'outside');
  const link = join(value.library, 'images', 'escape.jpg');
  await symlink(outside, link);
  const itemPath = join(value.snapshot, 'items.ndjson');
  const item = JSON.parse((await readFile(itemPath, 'utf8')).trim());

  await writeFile(itemPath, `${JSON.stringify({ ...item, sourcePath: outside })}\n`);
  await assert.rejects(
    openMigrationSnapshot(value.snapshot, { repairMissingChecksums: true }),
    /outside the frozen Eagle library/i,
  );

  await writeFile(itemPath, `${JSON.stringify({ ...item, sourcePath: link })}\n`);
  await assert.rejects(
    openMigrationSnapshot(value.snapshot, { repairMissingChecksums: true }),
    /symlink/i,
  );
});

