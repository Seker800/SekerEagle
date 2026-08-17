'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const FORMAT_VERSION = 1;

async function exportMigrationSnapshot(scan, { outputRoot, migrationId }) {
  assertMigrationId(migrationId);
  const libraryRoot = await fsp.realpath(scan.library.path);
  const finalDirectory = path.join(outputRoot, migrationId);
  const temporaryDirectory = path.join(
    outputRoot,
    `.tmp-${migrationId}-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await fsp.mkdir(temporaryDirectory, { mode: 0o700 });
  try {
    const itemsPath = path.join(temporaryDirectory, 'items.ndjson');
    const itemsHandle = await fsp.open(itemsPath, 'wx', 0o600);
    let itemCount = 0;
    let byteSize = 0;
    try {
      for await (const rawItem of scan.iterateItems()) {
        const sourceItemId = String(rawItem?.sourceItemId || '');
        if (!sourceItemId || sourceItemId.length > 255) throw new Error('sourceItemId 无效。');
        if (rawItem.isDeleted) {
          await itemsHandle.write(`${JSON.stringify(rawItem)}\n`);
          itemCount += 1;
          byteSize += Number(rawItem.size);
          continue;
        }
        const source = await scan.sourceFiles.get(sourceItemId);
        if (!source?.filePath) throw new Error(`迁移项 ${sourceItemId} 缺少源文件。`);
        const sourcePath = await assertSafeSourcePath(libraryRoot, source.filePath);
        const size = Number(rawItem.size);
        if (!Number.isSafeInteger(size) || size < 1 || size !== Number(source.size)) {
          throw new Error(`迁移项 ${sourceItemId} 的文件大小不一致。`);
        }
        if (!/^[a-f0-9]{64}$/i.test(String(rawItem.contentSha256 || ''))) {
          throw new Error(`迁移项 ${sourceItemId} 缺少有效 SHA-256。`);
        }
        await itemsHandle.write(`${JSON.stringify({ ...rawItem, sourcePath })}\n`);
        itemCount += 1;
        byteSize += size;
      }
    } finally {
      await itemsHandle.close();
    }
    if (itemCount !== Number(scan.itemCount) || byteSize !== Number(scan.byteSize)) {
      throw new Error('扫描结果数量或字节数在导出期间发生变化。');
    }

    const definitions = {
      folders: ['folders.json', scan.folders || []],
      tags: ['tags.json', scan.tags || []],
      tagGroups: ['tag-groups.json', scan.tagGroups || []],
    };
    for (const [fileName, values] of Object.values(definitions)) {
      await atomicWrite(path.join(temporaryDirectory, fileName), `${JSON.stringify(values)}\n`);
    }
    const inventory = {
      itemCount,
      byteSize,
      unreadableItemCount: Number(scan.unreadableItemCount || 0),
      unreadableItems: scan.unreadableItems || [],
      dataWarningCount: Number(scan.dataWarningCount || 0),
      dataWarnings: scan.dataWarnings || [],
      mergedTagCount: Number(scan.mergedTagCount || 0),
      mergedTagDetails: scan.mergedTagDetails || [],
      exportedAt: new Date().toISOString(),
    };
    await atomicWrite(
      path.join(temporaryDirectory, 'inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    );

    const fileNames = {
      items: 'items.ndjson',
      folders: definitions.folders[0],
      tags: definitions.tags[0],
      tagGroups: definitions.tagGroups[0],
      inventory: 'inventory.json',
    };
    const files = {};
    for (const [key, fileName] of Object.entries(fileNames)) {
      files[key] = { path: fileName, sha256: await sha256File(path.join(temporaryDirectory, fileName)) };
    }
    const header = {
      formatVersion: FORMAT_VERSION,
      migrationId,
      library: {
        name: String(scan.library.name || 'Eagle 图库'),
        rootPath: libraryRoot,
        sourceModifiedAt: String(scan.library.sourceModifiedAt || ''),
      },
      itemCount,
      byteSize,
      files,
    };
    header.snapshotSha256 = snapshotIdentityHash(header);
    await atomicWrite(
      path.join(temporaryDirectory, 'snapshot.json'),
      `${JSON.stringify(header, null, 2)}\n`,
    );
    await fsp.rename(temporaryDirectory, finalDirectory);
    return { directory: finalDirectory, itemCount, byteSize, snapshotSha256: header.snapshotSha256 };
  } catch (error) {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function assertSafeSourcePath(libraryRoot, inputPath) {
  const stats = await fsp.lstat(inputPath);
  if (stats.isSymbolicLink()) throw new Error('source file must not be a symlink.');
  if (!stats.isFile()) throw new Error('source file is not a regular file.');
  const canonical = await fsp.realpath(inputPath);
  const fromRoot = path.relative(libraryRoot, canonical);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error('source file is outside the Eagle library.');
  }
  return canonical;
}

async function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsp.rename(temporary, filePath);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(filePath);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}

function snapshotIdentityHash(header) {
  const files = Object.fromEntries(
    Object.entries(header.files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, { path: value.path, sha256: value.sha256 }]),
  );
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        formatVersion: header.formatVersion,
        migrationId: header.migrationId,
        library: header.library,
        itemCount: header.itemCount,
        byteSize: header.byteSize,
        files,
      }),
    )
    .digest('hex');
}

function assertMigrationId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ''))) {
    throw new Error('migrationId 无效。');
  }
}

module.exports = { FORMAT_VERSION, exportMigrationSnapshot, snapshotIdentityHash };
