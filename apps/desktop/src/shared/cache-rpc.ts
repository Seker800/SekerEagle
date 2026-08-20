import type { CacheKind, ReadyCacheEntry } from '../utility/cache/cache-index';
import { CacheEngine } from '../utility/cache/cache-engine';

type CacheRpcMethod =
  | 'initialize'
  | 'beginWrite'
  | 'append'
  | 'commit'
  | 'abort'
  | 'acquire'
  | 'release'
  | 'renewAuthorization'
  | 'invalidate'
  | 'getStats'
  | 'getNamespaceStats'
  | 'setLimitBytes'
  | 'invalidateAsset'
  | 'clearNamespace'
  | 'expireAuthorizations'
  | 'close';

interface CacheRpcRequest {
  type: 'request';
  id: string;
  method: CacheRpcMethod;
  params: unknown;
}

interface CacheRpcSuccess {
  type: 'response';
  id: string;
  ok: true;
  result: unknown;
}

interface CacheRpcFailure {
  type: 'response';
  id: string;
  ok: false;
  error: string;
}

export type CacheRpcMessage = CacheRpcRequest | CacheRpcSuccess | CacheRpcFailure;

export interface CacheRpcEndpoint {
  postMessage(message: CacheRpcMessage): void;
  subscribe(listener: (message: CacheRpcMessage) => void): () => void;
}

export class CacheRpcClient {
  private readonly endpoint: CacheRpcEndpoint;
  private readonly unsubscribe: () => void;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: NodeJS.Timeout }
  >();
  private sequence = 0;
  private closed = false;

  constructor(endpoint: CacheRpcEndpoint) {
    this.endpoint = endpoint;
    this.unsubscribe = endpoint.subscribe((message) => this.receive(message));
  }

  async initialize(options: {
    cacheRoot: string;
    limitBytes: number;
    enforceDiskSafety?: boolean;
  }) {
    return asRecord(await this.call('initialize', options));
  }

  async beginWrite(input: {
    keyHash: Buffer;
    namespaceId: string;
    assetId: string;
    kind: CacheKind;
    expectedLength: number;
    now: number;
  }): Promise<string> {
    return asString(
      await this.call('beginWrite', { ...input, keyHash: input.keyHash.toString('hex') }),
    );
  }

  async append(writeId: string, chunk: Uint8Array): Promise<void> {
    await this.call('append', { writeId, chunk });
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
    await this.call('commit', { writeId, metadata });
  }

  async abort(writeId: string): Promise<void> {
    await this.call('abort', { writeId });
  }

  async acquire(
    keyHash: Buffer,
    namespaceId: string,
    now: number,
  ): Promise<(ReadyCacheEntry & { leaseId: string; filePath: string }) | null> {
    const result = await this.call('acquire', {
      keyHash: keyHash.toString('hex'),
      namespaceId,
      now,
    });
    return result === null
      ? null
      : (asRecord(result) as unknown as ReadyCacheEntry & { leaseId: string; filePath: string });
  }

  async release(leaseId: string): Promise<void> {
    await this.call('release', { leaseId });
  }

  async renewAuthorization(
    keyHash: Buffer,
    namespaceId: string,
    input: {
      verifiedAt: number;
      authorizationLeaseUntil: number;
      etag: string | null;
      lastModified: string | null;
    },
  ): Promise<boolean> {
    return asBoolean(
      await this.call('renewAuthorization', {
        keyHash: keyHash.toString('hex'),
        namespaceId,
        input,
      }),
    );
  }

  async invalidate(keyHash: Buffer): Promise<boolean> {
    return asBoolean(await this.call('invalidate', { keyHash: keyHash.toString('hex') }));
  }

  async getStats(): Promise<{ entryCount: number; logicalBytes: number; allocatedBytes: number }> {
    return asRecord(await this.call('getStats', {})) as unknown as {
      entryCount: number;
      logicalBytes: number;
      allocatedBytes: number;
    };
  }

  async getNamespaceStats(namespaceId: string) {
    return asRecord(await this.call('getNamespaceStats', { namespaceId })) as unknown as {
      entryCount: number;
      logicalBytes: number;
      allocatedBytes: number;
      hitCount: number;
      missCount: number;
      savedBytes: number;
    };
  }

  async setLimitBytes(limitBytes: number): Promise<void> {
    await this.call('setLimitBytes', { limitBytes });
  }

  async invalidateAsset(namespaceId: string, assetId: string) {
    return asRecord(await this.call('invalidateAsset', { namespaceId, assetId })) as unknown as {
      deleted: number;
      deferred: number;
    };
  }

  async clearNamespace(namespaceId: string) {
    return asRecord(await this.call('clearNamespace', { namespaceId })) as unknown as {
      deleted: number;
      deferred: number;
    };
  }

  async expireAuthorizations(): Promise<number> {
    return asNumber(await this.call('expireAuthorizations', {}));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.call('close', {});
    this.closed = true;
    this.unsubscribe();
  }

  private call(method: CacheRpcMethod, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('缓存 RPC 已关闭。'));
    const id = `${process.pid}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`缓存 RPC 超时：${method}`));
      }, 30_000);
      timeout.unref();
      this.pending.set(id, { resolve, reject, timeout });
      this.endpoint.postMessage({ type: 'request', id, method, params });
    });
  }

  private receive(message: CacheRpcMessage): void {
    if (message.type !== 'response') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }
}

export class CacheRpcDispatcher {
  private engine: CacheEngine | null = null;

  async dispatch(message: CacheRpcMessage): Promise<CacheRpcMessage> {
    if (message.type !== 'request') {
      return { type: 'response', id: message.id, ok: false, error: '缓存 RPC 消息方向无效。' };
    }
    try {
      return {
        type: 'response',
        id: message.id,
        ok: true,
        result: await this.execute(message.method, message.params),
      };
    } catch (error) {
      return {
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : '缓存 RPC 执行失败。',
      };
    }
  }

  private async execute(method: CacheRpcMethod, raw: unknown): Promise<unknown> {
    const params = asRecord(raw);
    if (method === 'initialize') {
      if (this.engine) throw new Error('缓存引擎已经初始化。');
      this.engine = new CacheEngine({
        cacheRoot: asString(params.cacheRoot),
        limitBytes: asNumber(params.limitBytes),
        enforceDiskSafety: asOptionalBoolean(params.enforceDiskSafety),
      });
      return this.engine.initialize();
    }
    const engine = this.requireEngine();
    switch (method) {
      case 'beginWrite':
        return engine.beginWrite({
          keyHash: decodeHash(params.keyHash),
          namespaceId: asString(params.namespaceId),
          assetId: asString(params.assetId),
          kind: asCacheKind(params.kind),
          expectedLength: asNumber(params.expectedLength),
          now: asNumber(params.now),
        });
      case 'append':
        return engine.append(asString(params.writeId), asBytes(params.chunk));
      case 'commit':
        return engine.commit(asString(params.writeId), asCommitMetadata(params.metadata));
      case 'abort':
        return engine.abort(asString(params.writeId));
      case 'acquire':
        return engine.acquire(
          decodeHash(params.keyHash),
          asString(params.namespaceId),
          asNumber(params.now),
        );
      case 'release':
        await engine.release(asString(params.leaseId));
        return null;
      case 'renewAuthorization':
        return engine.renewAuthorization(
          decodeHash(params.keyHash),
          asString(params.namespaceId),
          asAuthorizationMetadata(params.input),
        );
      case 'invalidate':
        return engine.invalidate(decodeHash(params.keyHash));
      case 'getStats':
        return engine.getStats();
      case 'getNamespaceStats':
        return engine.getNamespaceStats(asString(params.namespaceId));
      case 'setLimitBytes':
        return engine.setLimitBytes(asNumber(params.limitBytes));
      case 'invalidateAsset':
        return engine.invalidateAsset(asString(params.namespaceId), asString(params.assetId));
      case 'clearNamespace':
        return engine.clearNamespace(asString(params.namespaceId));
      case 'expireAuthorizations':
        return engine.expireAuthorizations();
      case 'close':
        await engine.close();
        this.engine = null;
        return null;
      default:
        throw new Error('未知缓存 RPC 方法。');
    }
  }

  private requireEngine(): CacheEngine {
    if (!this.engine) throw new Error('缓存引擎尚未初始化。');
    return this.engine;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('RPC 对象无效。');
  return value as Record<string, unknown>;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error('RPC 布尔值无效。');
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('RPC 字符串无效。');
  return value;
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('RPC 数字无效。');
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('RPC 布尔值无效。');
  return value;
}

function asBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error('RPC 二进制块无效。');
  return value;
}

function decodeHash(value: unknown): Buffer {
  const hex = asString(value);
  if (!/^[0-9a-f]{64}$/u.test(hex)) throw new Error('RPC 缓存 hash 无效。');
  return Buffer.from(hex, 'hex');
}

function asCacheKind(value: unknown): CacheKind {
  if (value !== 'RENDITION' && value !== 'TILE') throw new Error('RPC 缓存类型无效。');
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value === null) return null;
  return asString(value);
}

function asAuthorizationMetadata(value: unknown) {
  const input = asRecord(value);
  return {
    verifiedAt: asNumber(input.verifiedAt),
    authorizationLeaseUntil: asNumber(input.authorizationLeaseUntil),
    etag: asNullableString(input.etag),
    lastModified: asNullableString(input.lastModified),
  };
}

function asCommitMetadata(value: unknown) {
  const input = asRecord(value);
  return {
    expectedLength: asNumber(input.expectedLength),
    contentType: asString(input.contentType),
    ...asAuthorizationMetadata(input),
  };
}
