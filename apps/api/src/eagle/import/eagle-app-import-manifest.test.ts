import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEagleImportCandidateTags,
  canonicalizeEagleImportManifestChunk,
  EagleImportManifestValidationError,
  mapEagleImportItemMetadata,
  validateEagleImportManifestChunk,
} from './eagle-app-import-manifest';

test('folds folder names and original tags directly into normalized manual tags', () => {
  const result = buildEagleImportCandidateTags({
    tagNames: ['设计', ' 灵感 '],
    folderIds: ['folder-a', 'folder-b', 'folder-c'],
    folders: [
      { sourceId: 'folder-a', name: '设计', parentSourceId: 'root-a' },
      { sourceId: 'folder-b', name: '设计', parentSourceId: 'root-b' },
      { sourceId: 'folder-c', name: '参考', parentSourceId: null },
    ],
  });

  assert.deepEqual(result.names, ['设计', '灵感', '参考']);
  assert.equal(result.folderAssignmentCount, 3);
  assert.equal(result.collapsedFolderNameCount, 1);
  assert.equal(result.mergedWithOriginalTagCount, 1);
});

test('maps Eagle metadata without conflating source time and database audit time', () => {
  const fallback = new Date('2026-08-14T12:00:00.000Z');
  const result = mapEagleImportItemMetadata(
    {
      name: ' 海报 ',
      originalFileName: 'poster.png',
      star: 0,
      annotation: '说明',
      sourceUrl: 'https://example.com/poster',
      importedAt: 1_700_000_000_123,
      modifiedAt: 1_700_000_100_456,
    },
    fallback,
  );

  assert.equal(result.displayName, '海报');
  assert.equal(result.rating, null);
  assert.equal(result.description, '说明');
  assert.equal(result.sourceUrl, 'https://example.com/poster');
  assert.equal(result.libraryAddedAt.toISOString(), '2023-11-14T22:13:20.123Z');
  assert.equal(result.sourceModifiedAt?.toISOString(), '2023-11-14T22:15:00.456Z');
  assert.deepEqual(result.warnings, []);
});

test('falls back invalid optional source metadata with explicit warnings', () => {
  const fallback = new Date('2026-08-14T12:00:00.000Z');
  const result = mapEagleImportItemMetadata(
    {
      name: '',
      originalFileName: 'fallback.gif',
      star: 5,
      annotation: '',
      sourceUrl: 'file:///Users/demo/private.gif',
      importedAt: 0,
      modifiedAt: null,
    },
    fallback,
  );

  assert.equal(result.displayName, 'fallback');
  assert.equal(result.rating, 5);
  assert.equal(result.description, null);
  assert.equal(result.sourceUrl, null);
  assert.equal(result.libraryAddedAt, fallback);
  assert.deepEqual(result.warnings, ['INVALID_SOURCE_URL', 'INVALID_IMPORTED_AT']);
});

test('validates manifest version, chunk size and supported media without accepting deleted items', () => {
  const result = validateEagleImportManifestChunk({
    manifestVersion: 1,
    chunkKey: 'chunk-1',
    folders: [],
    tags: [],
    tagGroups: [],
    items: [
      {
        sourceItemId: 'item-1',
        name: 'still',
        originalFileName: 'still.jpg',
        extension: 'jpg',
        mimeType: 'image/jpeg',
        size: 100,
        importedAt: 1_700_000_000_000,
        modifiedAt: 1_700_000_000_000,
        star: 3,
        annotation: '',
        sourceUrl: '',
        tagNames: [],
        folderIds: [],
        isDeleted: false,
      },
      {
        sourceItemId: 'item-2',
        name: 'trash',
        originalFileName: 'trash.png',
        extension: 'png',
        mimeType: 'image/png',
        size: 100,
        importedAt: 1_700_000_000_000,
        modifiedAt: 1_700_000_000_000,
        star: 0,
        annotation: '',
        sourceUrl: '',
        tagNames: [],
        folderIds: [],
        isDeleted: true,
      },
      {
        sourceItemId: 'item-3',
        name: 'future',
        originalFileName: 'future.svg',
        extension: 'svg',
        mimeType: 'image/svg+xml',
        size: 100,
        importedAt: 1_700_000_000_000,
        modifiedAt: 1_700_000_000_000,
        star: 0,
        annotation: '',
        sourceUrl: '',
        tagNames: [],
        folderIds: [],
        isDeleted: false,
      },
    ],
  });

  assert.deepEqual(result.acceptedItemIds, ['item-1']);
  assert.deepEqual(result.skippedDeletedItemIds, ['item-2']);
  assert.deepEqual(result.skippedUnsupportedItemIds, ['item-3']);
});

test('canonicalizes source identities before they cross the application boundary', () => {
  const input = {
    manifestVersion: 1,
    chunkKey: ' chunk-1 ',
    folders: [{ sourceId: ' folder-1 ', name: 'Folder', parentSourceId: ' parent-1 ' }],
    tags: [],
    tagGroups: [{ sourceId: ' group-1 ', name: 'Group' }],
    items: [
      {
        sourceItemId: ' item-1 ',
        name: 'still',
        originalFileName: 'still.jpg',
        extension: 'jpg',
        mimeType: 'image/jpeg',
        size: 100,
        importedAt: 1_700_000_000_000,
        modifiedAt: null,
        star: 0,
        annotation: '',
        sourceUrl: '',
        tagNames: [],
        folderIds: [' folder-1 '],
        isDeleted: false,
      },
    ],
  };

  const result = canonicalizeEagleImportManifestChunk(input);

  assert.equal(result.chunkKey, 'chunk-1');
  assert.equal(result.folders[0]!.sourceId, 'folder-1');
  assert.equal(result.folders[0]!.parentSourceId, 'parent-1');
  assert.equal(result.tagGroups[0]!.sourceId, 'group-1');
  assert.equal(result.items[0]!.sourceItemId, 'item-1');
  assert.deepEqual(result.items[0]!.folderIds, ['folder-1']);
});

test('reports duplicate canonical source ids as a domain validation error', () => {
  const baseItem = {
    sourceItemId: 'item-1',
    name: 'still',
    originalFileName: 'still.jpg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    size: 100,
    importedAt: 1_700_000_000_000,
    modifiedAt: null,
    star: 0,
    annotation: '',
    sourceUrl: '',
    tagNames: [],
    folderIds: [],
    isDeleted: false,
  };

  assert.throws(
    () =>
      canonicalizeEagleImportManifestChunk({
        manifestVersion: 1,
        chunkKey: 'chunk-1',
        folders: [],
        tags: [],
        tagGroups: [],
        items: [baseItem, { ...baseItem, sourceItemId: ' item-1 ' }],
      }),
    EagleImportManifestValidationError,
  );
});

test('manifest v2 requires a lowercase SHA-256 and source file timestamp', () => {
  const item = {
    sourceItemId: 'item-v2',
    name: 'still',
    originalFileName: 'still.jpg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    size: 100,
    importedAt: 1_700_000_000_000,
    modifiedAt: null,
    star: 0,
    annotation: '',
    sourceUrl: '',
    tagNames: [],
    folderIds: [],
    isDeleted: false,
  };

  assert.throws(
    () =>
      validateEagleImportManifestChunk({
        manifestVersion: 2,
        chunkKey: 'chunk-v2',
        folders: [],
        tags: [],
        tagGroups: [],
        items: [{ ...item, contentSha256: 'ABC', sourceFileModifiedAt: 1_700_000_000_000 }],
      }),
    EagleImportManifestValidationError,
  );

  const result = validateEagleImportManifestChunk({
    manifestVersion: 2,
    chunkKey: 'chunk-v2',
    folders: [],
    tags: [],
    tagGroups: [],
    items: [
      {
        ...item,
        contentSha256: 'a'.repeat(64),
        sourceFileModifiedAt: 1_700_000_000_000,
      },
    ],
  });
  assert.deepEqual(result.acceptedItemIds, ['item-v2']);
});

test('manifest v2 accepts a deleted source tombstone without reading content identity', () => {
  const result = validateEagleImportManifestChunk({
    manifestVersion: 2,
    chunkKey: 'deleted-v2',
    folders: [],
    tags: [],
    tagGroups: [],
    items: [
      {
        sourceItemId: 'deleted-1',
        name: 'trashed',
        originalFileName: 'trashed.jpg',
        extension: 'jpg',
        mimeType: 'image/jpeg',
        size: 0,
        importedAt: 0,
        modifiedAt: null,
        star: 0,
        annotation: '',
        sourceUrl: '',
        tagNames: [],
        folderIds: [],
        isDeleted: true,
      },
    ],
  });

  assert.deepEqual(result.skippedDeletedItemIds, ['deleted-1']);
  assert.deepEqual(result.acceptedItemIds, []);
});
