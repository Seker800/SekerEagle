import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

const FORMAT_VERSION = 1;
const DEFINITION_KEYS = ['folders', 'tags', 'tagGroups'] as const;

interface SnapshotFileDescriptor {
  path: string;
  sha256: string;
}

export interface SnapshotHeader {
  formatVersion: number;
  migrationId: string;
  library: { name: string; rootPath: string; sourceModifiedAt: string };
  itemCount: number;
  byteSize: number;
  files: {
    items: SnapshotFileDescriptor;
    folders: SnapshotFileDescriptor;
    tags: SnapshotFileDescriptor;
    tagGroups: SnapshotFileDescriptor;
    inventory?: SnapshotFileDescriptor;
  };
  snapshotSha256: string;
}

export interface SnapshotItem {
  sourceItemId: string;
  sourcePath: string;
  contentSha256: string;
  size: number;
  [key: string]: unknown;
}

export class SnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotIntegrityError';
  }
}

export interface MigrationSnapshot {
  directory: string;
  header: SnapshotHeader;
  folders: unknown[];
  tags: unknown[];
  tagGroups: unknown[];
  iterateItems(): AsyncGenerator<SnapshotItem>;
  sourceFiles: { get(sourceItemId: string): Promise<string | null> };
}

export async function openMigrationSnapshot(
  directory: string,
  options: { repairMissingChecksums?: boolean } = {},
): Promise<MigrationSnapshot> {
  const snapshotDirectory = await realpath(directory);
  const headerPath = resolve(snapshotDirectory, 'snapshot.json');
  const parsed = parseHeader(JSON.parse(await readFile(headerPath, 'utf8')));
  const libraryRoot = await realpath(parsed.library.rootPath);
  const descriptors = Object.values(parsed.files).filter(
    (descriptor): descriptor is SnapshotFileDescriptor => Boolean(descriptor),
  );
  for (const descriptor of descriptors) validateSnapshotRelativePath(snapshotDirectory, descriptor.path);

  const actualHashes = new Map<string, string>();
  for (const descriptor of descriptors) {
    const filePath = resolve(snapshotDirectory, descriptor.path);
    const actual = await sha256File(filePath);
    actualHashes.set(descriptor.path, actual);
    if (descriptor.sha256 && descriptor.sha256 !== actual) {
      throw new SnapshotIntegrityError(`迁移快照文件校验失败：${descriptor.path}`);
    }
    if (!descriptor.sha256 && !options.repairMissingChecksums) {
      throw new SnapshotIntegrityError(`迁移快照缺少校验值：${descriptor.path}`);
    }
  }

  const itemPaths = new Map<string, string>();
  let itemCount = 0;
  let byteSize = 0;
  const itemsPath = resolve(snapshotDirectory, parsed.files.items.path);
  for await (const item of iterateItemsFile(itemsPath, libraryRoot)) {
    if (itemPaths.has(item.sourceItemId)) {
      throw new SnapshotIntegrityError(`迁移快照包含重复 sourceItemId：${item.sourceItemId}`);
    }
    itemPaths.set(item.sourceItemId, item.sourcePath);
    itemCount += 1;
    byteSize += item.size;
  }
  if (itemCount !== parsed.itemCount || byteSize !== parsed.byteSize) {
    throw new SnapshotIntegrityError('迁移快照声明的数量或字节数与 items.ndjson 不一致。');
  }

  const repaired = applyHashes(parsed, actualHashes);
  const snapshotSha256 = snapshotIdentityHash(repaired);
  if (parsed.snapshotSha256 && parsed.snapshotSha256 !== snapshotSha256) {
    throw new SnapshotIntegrityError('迁移快照身份校验失败。');
  }
  if ((!parsed.snapshotSha256 || descriptors.some((value) => !value.sha256)) && options.repairMissingChecksums) {
    repaired.snapshotSha256 = snapshotSha256;
    await writeFile(headerPath, `${JSON.stringify(repaired, null, 2)}\n`, { mode: 0o600 });
  }
  repaired.snapshotSha256 = snapshotSha256;

  const definitions = await Promise.all(
    DEFINITION_KEYS.map(async (key) => {
      const value: unknown = JSON.parse(
        await readFile(resolve(snapshotDirectory, repaired.files[key].path), 'utf8'),
      );
      if (!Array.isArray(value)) throw new SnapshotIntegrityError(`${key} 定义必须是数组。`);
      return value;
    }),
  );

  return {
    directory: snapshotDirectory,
    header: repaired,
    folders: definitions[0]!,
    tags: definitions[1]!,
    tagGroups: definitions[2]!,
    iterateItems: () => iterateItemsFile(itemsPath, libraryRoot),
    sourceFiles: { get: async (sourceItemId) => itemPaths.get(sourceItemId) ?? null },
  };
}

async function* iterateItemsFile(
  itemsPath: string,
  libraryRoot: string,
): AsyncGenerator<SnapshotItem> {
  const input = createReadStream(itemsPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new SnapshotIntegrityError(`items.ndjson 第 ${lineNumber} 行不是有效 JSON。`);
      }
      const item = parseItem(value, lineNumber);
      await assertSafeSourcePath(libraryRoot, item.sourcePath);
      yield item;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

async function assertSafeSourcePath(libraryRoot: string, sourcePath: string): Promise<void> {
  if (!isAbsolute(sourcePath)) throw new SnapshotIntegrityError('sourcePath 必须是绝对路径。');
  const stats = await lstat(sourcePath);
  if (stats.isSymbolicLink()) throw new SnapshotIntegrityError('sourcePath 不得是 symlink。');
  if (!stats.isFile()) throw new SnapshotIntegrityError('sourcePath 不是普通文件。');
  const canonical = await realpath(sourcePath);
  const pathFromRoot = relative(libraryRoot, canonical);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new SnapshotIntegrityError('sourcePath is outside the frozen Eagle library.');
  }
}

function validateSnapshotRelativePath(directory: string, path: string): void {
  const absolute = resolve(directory, path);
  const fromRoot = relative(directory, absolute);
  if (!path || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new SnapshotIntegrityError('快照文件路径越界。');
  }
}

function parseHeader(value: unknown): SnapshotHeader {
  if (!isRecord(value) || value.formatVersion !== FORMAT_VERSION) {
    throw new SnapshotIntegrityError('迁移快照格式版本不受支持。');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value.migrationId ?? ''))) {
    throw new SnapshotIntegrityError('migrationId 无效。');
  }
  if (!isRecord(value.library) || !isAbsolute(String(value.library.rootPath ?? ''))) {
    throw new SnapshotIntegrityError('library.rootPath 无效。');
  }
  if (!isRecord(value.files)) throw new SnapshotIntegrityError('快照文件声明缺失。');
  const files = {
    items: parseDescriptor(value.files.items, 'items'),
    folders: parseDescriptor(value.files.folders, 'folders'),
    tags: parseDescriptor(value.files.tags, 'tags'),
    tagGroups: parseDescriptor(value.files.tagGroups, 'tagGroups'),
    ...(value.files.inventory
      ? { inventory: parseDescriptor(value.files.inventory, 'inventory') }
      : {}),
  };
  return {
    formatVersion: FORMAT_VERSION,
    migrationId: String(value.migrationId),
    library: {
      name: String(value.library.name ?? ''),
      rootPath: String(value.library.rootPath),
      sourceModifiedAt: String(value.library.sourceModifiedAt ?? ''),
    },
    itemCount: requireSafeNonNegativeInteger(value.itemCount, 'itemCount'),
    byteSize: requireSafeNonNegativeInteger(value.byteSize, 'byteSize'),
    files,
    snapshotSha256: value.snapshotSha256 ? String(value.snapshotSha256) : '',
  };
}

function parseDescriptor(value: unknown, name: string): SnapshotFileDescriptor {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.sha256 !== 'string') {
    throw new SnapshotIntegrityError(`${name} 文件声明无效。`);
  }
  if (value.sha256 && !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new SnapshotIntegrityError(`${name} 校验值无效。`);
  }
  return { path: value.path, sha256: value.sha256 };
}

function parseItem(value: unknown, lineNumber: number): SnapshotItem {
  if (!isRecord(value)) throw new SnapshotIntegrityError(`items.ndjson 第 ${lineNumber} 行无效。`);
  const sourceItemId = String(value.sourceItemId ?? '');
  const sourcePath = String(value.sourcePath ?? '');
  const contentSha256 = String(value.contentSha256 ?? '').toLowerCase();
  if (!sourceItemId || sourceItemId.length > 255) throw new SnapshotIntegrityError('sourceItemId 无效。');
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new SnapshotIntegrityError('contentSha256 无效。');
  return {
    ...value,
    sourceItemId,
    sourcePath,
    contentSha256,
    size: requireSafeNonNegativeInteger(value.size, 'size'),
  };
}

function applyHashes(header: SnapshotHeader, hashes: Map<string, string>): SnapshotHeader {
  return {
    ...header,
    files: Object.fromEntries(
      Object.entries(header.files).map(([key, descriptor]) => [
        key,
        { ...descriptor, sha256: hashes.get(descriptor.path) ?? descriptor.sha256 },
      ]),
    ) as unknown as SnapshotHeader['files'],
  };
}

function snapshotIdentityHash(header: SnapshotHeader): string {
  const identity = {
    formatVersion: header.formatVersion,
    migrationId: header.migrationId,
    library: header.library,
    itemCount: header.itemCount,
    byteSize: header.byteSize,
    files: Object.fromEntries(
      Object.entries(header.files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, { path: value.path, sha256: value.sha256 }]),
    ),
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const input = createReadStream(path);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}

function requireSafeNonNegativeInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new SnapshotIntegrityError(`${name} 无效。`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}
