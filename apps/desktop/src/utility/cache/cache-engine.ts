import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CacheIndex, type CacheKind, type ReadyCacheEntry } from './cache-index';
import { CacheStore, type PendingCacheFile } from './cache-store';

interface ActiveWrite {
  keyHex: string;
  expectedLength: number;
  pending: PendingCacheFile;
}

export class CacheEngine {
  private readonly index: CacheIndex;
  private readonly store: CacheStore;
  private limitBytes: number;
  private readonly cacheRoot: string;
  private readonly indexPath: string;
  private readonly accountInfrastructureBytes: boolean;
  private readonly enforceDiskSafety: boolean;
  private readonly diskSpace: () => Promise<{ freeBytes: number; totalBytes: number }>;
  private readonly activeWrites = new Map<string, ActiveWrite>();
  private readonly writeByKey = new Map<string, string>();
  private readonly readLeases = new Map<string, string>();
  private readonly activeReadCounts = new Map<string, number>();
  private readonly deferredDeletes = new Map<string, Buffer>();
  private pendingAccesses: Array<{ keyHash: Buffer; at: number }> = [];
  private readonly pendingMetrics = new Map<
    string,
    { namespaceId: string; hitCount: number; missCount: number; savedBytes: number }
  >();
  private accessTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: {
    cacheRoot: string;
    limitBytes: number;
    accountInfrastructureBytes?: boolean;
    enforceDiskSafety?: boolean;
    diskSpace?: () => Promise<{ freeBytes: number; totalBytes: number }>;
  }) {
    if (!Number.isSafeInteger(options.limitBytes) || options.limitBytes < 1) {
      throw new Error('缓存容量无效。');
    }
    this.limitBytes = options.limitBytes;
    this.cacheRoot = path.resolve(options.cacheRoot);
    this.indexPath = path.join(this.cacheRoot, 'index.sqlite');
    this.accountInfrastructureBytes = options.accountInfrastructureBytes ?? true;
    this.enforceDiskSafety = options.enforceDiskSafety ?? true;
    this.diskSpace =
      options.diskSpace ??
      (async () => {
        const fileSystem = await statfs(this.cacheRoot);
        return {
          freeBytes: Number(fileSystem.bavail) * Number(fileSystem.bsize),
          totalBytes: Number(fileSystem.blocks) * Number(fileSystem.bsize),
        };
      });
    mkdirSync(this.cacheRoot, { recursive: true, mode: 0o700 });
    chmodSync(this.cacheRoot, 0o700);
    if (process.platform === 'darwin') {
      writeFileSync(path.join(this.cacheRoot, '.metadata_never_index'), '', { mode: 0o600 });
    }
    this.store = new CacheStore(path.join(this.cacheRoot, 'media'));
    this.index = new CacheIndex(this.indexPath);
  }

  async initialize(): Promise<{
    interruptedWrites: number;
    removedPartials: number;
    fullTreeScans: 0;
  }> {
    this.assertOpen();
    await excludeFromBackup(this.cacheRoot);
    const interrupted = this.index.recoverInterruptedWrites();
    const pendingDeletes = this.index.listPendingDeletes();
    const removedPartials = await this.store.removePartialsForHashes(interrupted);
    for (const keyHash of pendingDeletes) await this.store.remove(keyHash);
    this.index.deleteEntries(pendingDeletes);
    this.accessTimer = setInterval(() => this.flushAccesses(), 1_000);
    this.accessTimer.unref();
    return {
      interruptedWrites: interrupted.length,
      removedPartials,
      fullTreeScans: 0,
    };
  }

  async beginWrite(input: {
    keyHash: Buffer;
    namespaceId: string;
    assetId: string;
    kind: CacheKind;
    expectedLength: number;
    now: number;
  }): Promise<string> {
    this.assertOpen();
    if (!Number.isSafeInteger(input.expectedLength) || input.expectedLength < 1) {
      throw new Error('缓存预期长度无效。');
    }
    await this.ensureDiskSafetyReserve(input.expectedLength);
    const keyHex = input.keyHash.toString('hex');
    if (this.writeByKey.has(keyHex)) throw new Error('同一缓存对象已在写入中。');
    if (this.index.findReady(input.keyHash)) throw new Error('缓存对象已经存在。');
    this.index.beginWrite(input);
    try {
      const pending = await this.store.createPartial(input.keyHash);
      const writeId = randomUUID();
      this.activeWrites.set(writeId, { keyHex, expectedLength: input.expectedLength, pending });
      this.writeByKey.set(keyHex, writeId);
      return writeId;
    } catch (error) {
      this.index.discardWriting(input.keyHash);
      throw error;
    }
  }

  async append(writeId: string, chunk: Uint8Array): Promise<void> {
    this.assertOpen();
    const active = this.requireWrite(writeId);
    if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1 || chunk.byteLength > 1024 ** 2) {
      throw new Error('缓存写入块必须介于 1 字节和 1 MiB。');
    }
    await active.pending.handle.write(chunk);
  }

  async commit(
    writeId: string,
    metadata: {
      expectedLength: number;
      contentType: string;
      etag: string | null;
      lastModified: string | null;
      verifiedAt: number;
      authorizationLeaseUntil: number;
    },
  ): Promise<void> {
    this.assertOpen();
    const active = this.requireWrite(writeId);
    if (metadata.expectedLength !== active.expectedLength) {
      await this.abort(writeId);
      throw new Error('缓存媒体长度与写入声明不一致。');
    }
    const current = await active.pending.handle.stat();
    if (current.size !== metadata.expectedLength) {
      await this.abort(writeId);
      throw new Error('缓存媒体长度与上游声明不一致。');
    }
    try {
      const committed = await this.store.commitPartial(active.pending);
      this.index.commitReady(active.pending.keyHash, {
        logicalBytes: committed.logicalBytes,
        allocatedBytes: committed.allocatedBytes,
        contentType: metadata.contentType,
        etag: metadata.etag,
        lastModified: metadata.lastModified,
        verifiedAt: metadata.verifiedAt,
        authorizationLeaseUntil: metadata.authorizationLeaseUntil,
      });
    } catch (error) {
      await this.store.remove(active.pending.keyHash).catch(() => false);
      this.index.discardWriting(active.pending.keyHash);
      throw error;
    } finally {
      this.finishWrite(writeId, active);
    }
    await this.evictIfNeeded();
  }

  async abort(writeId: string): Promise<void> {
    const active = this.activeWrites.get(writeId);
    if (!active) return;
    await this.store.abandonPartial(active.pending);
    this.index.discardWriting(active.pending.keyHash);
    this.finishWrite(writeId, active);
  }

  async acquire(
    keyHash: Buffer,
    namespaceId: string,
    now: number,
  ): Promise<
    | (ReadyCacheEntry & {
        leaseId: string;
        filePath: string;
      })
    | null
  > {
    this.assertOpen();
    if (this.deferredDeletes.has(keyHash.toString('hex'))) return null;
    const entry = this.index.findReady(keyHash);
    if (!entry || entry.namespaceId !== namespaceId) {
      this.recordMetric(namespaceId, false, 0);
      return null;
    }
    if (!(await this.store.exists(keyHash))) {
      this.index.deleteEntries([keyHash]);
      this.recordMetric(namespaceId, false, 0);
      return null;
    }
    const keyHex = keyHash.toString('hex');
    const leaseId = randomUUID();
    this.readLeases.set(leaseId, keyHex);
    this.activeReadCounts.set(keyHex, (this.activeReadCounts.get(keyHex) ?? 0) + 1);
    this.pendingAccesses.push({ keyHash: Buffer.from(keyHash), at: now });
    this.recordMetric(namespaceId, true, entry.logicalBytes);
    if (this.pendingAccesses.length >= 1_000) this.flushAccesses();
    return { ...entry, leaseId, filePath: this.store.filePath(keyHash) };
  }

  async release(leaseId: string): Promise<void> {
    const keyHex = this.readLeases.get(leaseId);
    if (!keyHex) return;
    this.readLeases.delete(leaseId);
    const remaining = (this.activeReadCounts.get(keyHex) ?? 1) - 1;
    if (remaining > 0) this.activeReadCounts.set(keyHex, remaining);
    else {
      this.activeReadCounts.delete(keyHex);
      const deferred = this.deferredDeletes.get(keyHex);
      if (deferred) {
        this.deferredDeletes.delete(keyHex);
        await this.store.remove(deferred);
        this.index.deleteEntries([deferred]);
      }
    }
  }

  flushAccesses(): void {
    if (this.closed) return;
    if (this.pendingAccesses.length) {
      const batch = this.pendingAccesses;
      this.pendingAccesses = [];
      this.index.recordAccesses(batch);
    }
    if (this.pendingMetrics.size) {
      const metrics = [...this.pendingMetrics.values()];
      this.pendingMetrics.clear();
      this.index.recordMetrics(metrics);
    }
  }

  pendingAccessCount(): number {
    return this.pendingAccesses.length;
  }

  inspectEntry(keyHash: Buffer): ReadyCacheEntry | null {
    return this.index.findReady(keyHash);
  }

  getStats(): { entryCount: number; logicalBytes: number; allocatedBytes: number } {
    return this.index.getTotalStats();
  }

  getNamespaceStats(namespaceId: string): {
    entryCount: number;
    logicalBytes: number;
    allocatedBytes: number;
    hitCount: number;
    missCount: number;
    savedBytes: number;
  } {
    this.flushAccesses();
    return this.index.getStats(namespaceId);
  }

  getLimitBytes(): number {
    return this.limitBytes;
  }

  async setLimitBytes(limitBytes: number): Promise<void> {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) throw new Error('缓存容量无效。');
    this.limitBytes = limitBytes;
    await this.evictIfNeeded();
  }

  async invalidateAsset(
    namespaceId: string,
    assetId: string,
  ): Promise<{ deleted: number; deferred: number }> {
    return this.removeEntries(this.index.listAssetEntries(namespaceId, assetId));
  }

  async clearNamespace(namespaceId: string): Promise<{ deleted: number; deferred: number }> {
    return this.removeEntries(this.index.listNamespaceEntries(namespaceId));
  }

  renewAuthorization(
    keyHash: Buffer,
    namespaceId: string,
    input: {
      verifiedAt: number;
      authorizationLeaseUntil: number;
      etag: string | null;
      lastModified: string | null;
    },
  ): boolean {
    return this.index.renewAuthorization(keyHash, namespaceId, input);
  }

  expireAuthorizations(): number {
    return this.index.expireAuthorizations();
  }

  async invalidate(keyHash: Buffer): Promise<boolean> {
    this.assertOpen();
    const keyHex = keyHash.toString('hex');
    if (this.activeReadCounts.has(keyHex)) throw new Error('缓存对象仍在读取中。');
    await this.store.remove(keyHash);
    return this.index.deleteEntries([keyHash]).entries === 1;
  }

  async evictIfNeeded(): Promise<void> {
    this.assertOpen();
    const lowBytes = Math.floor(this.limitBytes * 0.9);
    const physicalBytes = await this.getPhysicalUsageBytes();
    if (physicalBytes < this.limitBytes) return;
    await this.reclaimBytes(Math.max(0, physicalBytes - lowBytes));
  }

  private async reclaimBytes(targetBytes: number): Promise<number> {
    let reclaimedBytes = 0;
    for (const segment of ['PROBATION', 'PROTECTED'] as const) {
      while (reclaimedBytes < targetBytes) {
        const candidates = this.index
          .listGlobalEvictionCandidates(segment, 256)
          .filter((keyHash) => !this.activeReadCounts.has(keyHash.toString('hex')));
        if (!candidates.length) break;
        for (const keyHash of candidates) await this.store.remove(keyHash);
        reclaimedBytes += this.index.deleteEntries(candidates).allocatedBytes;
      }
    }
    return reclaimedBytes;
  }

  async getPhysicalUsageBytes(): Promise<number> {
    const mediaBytes = this.index.getTotalStats().allocatedBytes;
    if (!this.accountInfrastructureBytes) return mediaBytes;
    const infrastructurePaths = [this.indexPath, `${this.indexPath}-wal`, `${this.indexPath}-shm`];
    const infrastructure = await Promise.all(
      infrastructurePaths.map((candidate) => allocatedBytes(candidate)),
    );
    const partials = await Promise.all(
      [...this.activeWrites.values()].map(async ({ pending }) => {
        const details = await pending.handle.stat();
        return allocationForStat(details.size, Number(details.blocks ?? 0));
      }),
    );
    return mediaBytes + sum(infrastructure) + sum(partials);
  }

  releaseAllForTesting(): void {
    this.readLeases.clear();
    this.activeReadCounts.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.accessTimer) clearInterval(this.accessTimer);
    this.flushAccesses();
    for (const active of this.activeWrites.values()) {
      await active.pending.handle.close().catch(() => undefined);
    }
    this.activeWrites.clear();
    this.writeByKey.clear();
    this.closed = true;
    this.index.close();
  }

  private requireWrite(writeId: string): ActiveWrite {
    const active = this.activeWrites.get(writeId);
    if (!active) throw new Error('缓存写入会话不存在。');
    return active;
  }

  private finishWrite(writeId: string, active: ActiveWrite): void {
    this.activeWrites.delete(writeId);
    this.writeByKey.delete(active.keyHex);
  }

  private async removeEntries(
    keyHashes: readonly Buffer[],
  ): Promise<{ deleted: number; deferred: number }> {
    let deferred = 0;
    const immediate: Buffer[] = [];
    for (const keyHash of keyHashes) {
      const keyHex = keyHash.toString('hex');
      if (this.activeReadCounts.has(keyHex)) {
        this.index.markPendingDeletes([keyHash], Date.now());
        this.deferredDeletes.set(keyHex, Buffer.from(keyHash));
        deferred += 1;
      } else {
        await this.store.remove(keyHash);
        immediate.push(keyHash);
      }
    }
    const { entries } = this.index.deleteEntries(immediate);
    return { deleted: entries, deferred };
  }

  private recordMetric(namespaceId: string, hit: boolean, savedBytes: number): void {
    const metric = this.pendingMetrics.get(namespaceId) ?? {
      namespaceId,
      hitCount: 0,
      missCount: 0,
      savedBytes: 0,
    };
    if (hit) {
      metric.hitCount += 1;
      metric.savedBytes += savedBytes;
    } else {
      metric.missCount += 1;
    }
    this.pendingMetrics.set(namespaceId, metric);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('缓存引擎已经关闭。');
  }

  private async ensureDiskSafetyReserve(expectedLength: number): Promise<void> {
    if (!this.enforceDiskSafety) return;
    const diskSpace = await this.diskSpace();
    let { freeBytes } = diskSpace;
    const { totalBytes } = diskSpace;
    if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error('无法确认缓存磁盘剩余空间。');
    }
    const safetyReserve = Math.min(
      5 * 1024 ** 3,
      Math.max(1024 ** 3, Math.floor(totalBytes * 0.05)),
    );
    const requiredFreeBytes = safetyReserve + expectedLength;
    if (freeBytes < requiredFreeBytes) {
      await this.reclaimBytes(requiredFreeBytes - freeBytes);
      ({ freeBytes } = await this.diskSpace());
    }
    if (freeBytes < requiredFreeBytes) throw new Error('磁盘剩余空间低于缓存安全线。');
  }
}

async function allocatedBytes(candidate: string): Promise<number> {
  try {
    const details = await stat(candidate);
    return allocationForStat(details.size, Number(details.blocks ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

function allocationForStat(size: number, blocks: number): number {
  return blocks > 0 ? blocks * 512 : Math.ceil(size / 4_096) * 4_096;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const execFileAsync = promisify(execFile);

async function excludeFromBackup(cacheRoot: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  await execFileAsync('/usr/bin/xattr', [
    '-w',
    'com.apple.metadata:com_apple_backup_excludeItem',
    'com.apple.backupd',
    cacheRoot,
  ]);
}
