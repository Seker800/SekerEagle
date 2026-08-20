import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CacheIndex, type CacheKind, type ReadyCacheEntry } from './cache-index';
import { CacheStore, type PendingCacheFile } from './cache-store';

interface ActiveWrite {
  keyHex: string;
  pending: PendingCacheFile;
}

export class CacheEngine {
  private readonly index: CacheIndex;
  private readonly store: CacheStore;
  private limitBytes: number;
  private readonly activeWrites = new Map<string, ActiveWrite>();
  private readonly writeByKey = new Map<string, string>();
  private readonly readLeases = new Map<string, string>();
  private readonly activeReadCounts = new Map<string, number>();
  private readonly deferredDeletes = new Map<string, Buffer>();
  private pendingAccesses: Array<{ keyHash: Buffer; at: number }> = [];
  private accessTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: { cacheRoot: string; limitBytes: number }) {
    if (!Number.isSafeInteger(options.limitBytes) || options.limitBytes < 1) {
      throw new Error('缓存容量无效。');
    }
    this.limitBytes = options.limitBytes;
    mkdirSync(options.cacheRoot, { recursive: true });
    this.store = new CacheStore(path.join(options.cacheRoot, 'media'));
    this.index = new CacheIndex(path.join(options.cacheRoot, 'index.sqlite'));
  }

  async initialize(): Promise<{
    interruptedWrites: number;
    removedPartials: number;
    fullTreeScans: 0;
  }> {
    this.assertOpen();
    const interrupted = this.index.recoverInterruptedWrites();
    const removedPartials = await this.store.removePartialsForHashes(interrupted);
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
    now: number;
  }): Promise<string> {
    this.assertOpen();
    const keyHex = input.keyHash.toString('hex');
    if (this.writeByKey.has(keyHex)) throw new Error('同一缓存对象已在写入中。');
    if (this.index.findReady(input.keyHash)) throw new Error('缓存对象已经存在。');
    this.index.beginWrite(input);
    try {
      const pending = await this.store.createPartial(input.keyHash);
      const writeId = randomUUID();
      this.activeWrites.set(writeId, { keyHex, pending });
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
    const entry = this.index.findReady(keyHash);
    if (!entry || entry.namespaceId !== namespaceId) return null;
    if (!(await this.store.exists(keyHash))) {
      this.index.deleteEntries([keyHash]);
      return null;
    }
    const keyHex = keyHash.toString('hex');
    const leaseId = randomUUID();
    this.readLeases.set(leaseId, keyHex);
    this.activeReadCounts.set(keyHex, (this.activeReadCounts.get(keyHex) ?? 0) + 1);
    this.pendingAccesses.push({ keyHash: Buffer.from(keyHash), at: now });
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
      }
    }
  }

  flushAccesses(): void {
    if (!this.pendingAccesses.length || this.closed) return;
    const batch = this.pendingAccesses;
    this.pendingAccesses = [];
    this.index.recordAccesses(batch);
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
  } {
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
    if (this.index.getTotalStats().allocatedBytes < this.limitBytes) return;
    for (const segment of ['PROBATION', 'PROTECTED'] as const) {
      while (this.index.getTotalStats().allocatedBytes > lowBytes) {
        const candidates = this.index
          .listGlobalEvictionCandidates(segment, 256)
          .filter((keyHash) => !this.activeReadCounts.has(keyHash.toString('hex')));
        if (!candidates.length) break;
        for (const keyHash of candidates) await this.store.remove(keyHash);
        this.index.deleteEntries(candidates);
      }
    }
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
    for (const keyHash of keyHashes) {
      const keyHex = keyHash.toString('hex');
      if (this.activeReadCounts.has(keyHex)) {
        this.deferredDeletes.set(keyHex, Buffer.from(keyHash));
        deferred += 1;
      } else {
        await this.store.remove(keyHash);
      }
    }
    const { entries } = this.index.deleteEntries(keyHashes);
    return { deleted: entries - deferred, deferred };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('缓存引擎已经关闭。');
  }
}
