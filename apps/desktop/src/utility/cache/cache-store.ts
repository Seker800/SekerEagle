import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, statfs, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { cacheFilePath } from './cache-path';

export interface PendingCacheFile {
  keyHash: Buffer;
  partialPath: string;
  handle: FileHandle;
}

export class CacheStore {
  private readonly root: string;
  private readonly tempRoot: string;

  constructor(cacheRoot: string) {
    this.root = path.resolve(cacheRoot);
    this.tempRoot = path.join(this.root, 'tmp');
  }

  async createPartial(keyHash: Buffer): Promise<PendingCacheFile> {
    const target = cacheFilePath(this.root, keyHash);
    await Promise.all([
      mkdir(this.tempRoot, { recursive: true }),
      mkdir(path.dirname(target), { recursive: true }),
    ]);
    const partialPath = path.join(
      this.tempRoot,
      `${keyHash.toString('hex')}-${randomUUID()}.partial`,
    );
    const handle = await open(partialPath, 'wx', 0o600);
    return { keyHash: Buffer.from(keyHash), partialPath, handle };
  }

  async commitPartial(pending: PendingCacheFile): Promise<{
    filePath: string;
    logicalBytes: number;
    allocatedBytes: number;
  }> {
    try {
      this.assertPending(pending);
      await pending.handle.sync();
    } catch (error) {
      await pending.handle.close().catch(() => undefined);
      throw error;
    }
    await pending.handle.close();

    const filePath = cacheFilePath(this.root, pending.keyHash);
    await mkdir(path.dirname(filePath), { recursive: true });
    await rename(pending.partialPath, filePath);
    const [fileStats, fileSystem] = await Promise.all([stat(filePath), statfs(this.root)]);
    const blockSize = Number(fileSystem.bsize) || 4_096;
    const reportedBlocks = Number(fileStats.blocks ?? 0);
    const allocatedBytes =
      reportedBlocks > 0 ? reportedBlocks * 512 : Math.ceil(fileStats.size / blockSize) * blockSize;
    return { filePath, logicalBytes: fileStats.size, allocatedBytes };
  }

  async abandonPartial(pending: PendingCacheFile): Promise<void> {
    await pending.handle.close().catch(() => undefined);
    if (!this.isInsideTemp(pending.partialPath)) return;
    await rm(pending.partialPath, { force: true });
  }

  async exists(keyHash: Buffer): Promise<boolean> {
    try {
      await stat(cacheFilePath(this.root, keyHash));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  openRead(keyHash: Buffer) {
    return createReadStream(cacheFilePath(this.root, keyHash));
  }

  async remove(keyHash: Buffer): Promise<boolean> {
    try {
      await rm(cacheFilePath(this.root, keyHash));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async removePartialsForHashes(keyHashes: readonly Buffer[]): Promise<number> {
    if (!keyHashes.length) return 0;
    const prefixes = [...new Set(keyHashes.map((keyHash) => `${keyHash.toString('hex')}-`))];
    let entries;
    try {
      entries = await readdir(this.tempRoot, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return 0;
      throw error;
    }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.partial')) continue;
      if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
      await rm(path.join(this.tempRoot, entry.name), { force: true });
      removed += 1;
    }
    return removed;
  }

  filePath(keyHash: Buffer): string {
    return cacheFilePath(this.root, keyHash);
  }

  private assertPending(pending: PendingCacheFile): void {
    if (!this.isInsideTemp(pending.partialPath))
      throw new Error('partial 文件不属于缓存临时目录。');
    const name = path.basename(pending.partialPath);
    if (!name.startsWith(`${pending.keyHash.toString('hex')}-`) || !name.endsWith('.partial')) {
      throw new Error('partial 文件与缓存 key 不匹配。');
    }
  }

  private isInsideTemp(candidate: string): boolean {
    const resolved = path.resolve(candidate);
    return resolved.startsWith(`${this.tempRoot}${path.sep}`);
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
