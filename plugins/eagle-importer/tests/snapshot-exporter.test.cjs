'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { exportMigrationSnapshot } = require('../js/snapshot-exporter');

test('exports a deterministic migration snapshot without secrets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sekereagle-exporter-'));
  const libraryRoot = path.join(root, 'Library.library');
  const sourcePath = path.join(libraryRoot, 'images', 'one.jpg');
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, 'one');
  const scan = {
    library: {
      name: 'Library',
      path: libraryRoot,
      sourceModifiedAt: '2026-08-17T00:00:00.000Z',
    },
    itemCount: 1,
    byteSize: 3,
    folders: [],
    tags: [],
    tagGroups: [],
    unreadableItemCount: 0,
    unreadableItems: [],
    dataWarningCount: 0,
    dataWarnings: [],
    mergedTagCount: 0,
    mergedTagDetails: [],
    iterateItems: async function* () {
      yield {
        sourceItemId: 'item-1',
        originalFileName: 'one.jpg',
        size: 3,
        contentSha256: 'a'.repeat(64),
      };
    },
    sourceFiles: {
      get: async () => ({
        filePath: sourcePath,
        size: 3,
        mimeType: 'image/jpeg',
        originalFileName: 'one.jpg',
      }),
    },
  };

  const result = await exportMigrationSnapshot(scan, {
    outputRoot: path.join(root, 'snapshots'),
    migrationId: 'migration-1',
  });

  assert.equal(result.itemCount, 1);
  const item = JSON.parse((await fs.readFile(path.join(result.directory, 'items.ndjson'), 'utf8')).trim());
  assert.equal(item.sourcePath, await fs.realpath(sourcePath));
  const serialized = await fs.readFile(path.join(result.directory, 'snapshot.json'), 'utf8');
  assert.doesNotMatch(serialized, /token|password|authorization/i);
  assert.match(JSON.parse(serialized).files.items.sha256, /^[a-f0-9]{64}$/);
});

test('refuses unstable identifiers and source files outside the library', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sekereagle-exporter-invalid-'));
  const libraryRoot = path.join(root, 'Library.library');
  const outside = path.join(root, 'outside.jpg');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(outside, 'outside');
  const scan = {
    library: { name: 'Library', path: libraryRoot, sourceModifiedAt: new Date().toISOString() },
    itemCount: 1,
    byteSize: 7,
    folders: [],
    tags: [],
    tagGroups: [],
    iterateItems: async function* () {
      yield { sourceItemId: 'item-1', size: 7, contentSha256: 'a'.repeat(64) };
    },
    sourceFiles: { get: async () => ({ filePath: outside, size: 7 }) },
  };

  await assert.rejects(
    exportMigrationSnapshot(scan, {
      outputRoot: path.join(root, 'snapshots'),
      migrationId: 'migration-1',
    }),
    /outside the Eagle library/i,
  );
});

test('exports deleted Eagle records without requiring a source file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sekereagle-exporter-deleted-'));
  const libraryRoot = path.join(root, 'Library.library');
  await fs.mkdir(libraryRoot);
  const result = await exportMigrationSnapshot(
    {
      library: { name: 'Library', path: libraryRoot, sourceModifiedAt: new Date().toISOString() },
      itemCount: 1,
      byteSize: 1,
      folders: [],
      tags: [],
      tagGroups: [],
      iterateItems: async function* () {
        yield { sourceItemId: 'deleted-1', size: 1, isDeleted: true };
      },
      sourceFiles: { get: async () => null },
    },
    { outputRoot: path.join(root, 'snapshots'), migrationId: 'migration-deleted' },
  );
  const item = JSON.parse((await fs.readFile(path.join(result.directory, 'items.ndjson'), 'utf8')).trim());
  assert.equal(item.isDeleted, true);
  assert.equal(Object.hasOwn(item, 'sourcePath'), false);
});
