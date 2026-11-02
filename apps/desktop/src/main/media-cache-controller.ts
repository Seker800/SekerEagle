import {
  buildCacheIdentity,
  buildNamespaceId,
  hashCacheIdentity,
  parseDesktopMediaUrl,
  type DesktopMediaIdentity,
} from '../shared/media-identity';
import type { CacheKind, ReadyCacheEntry } from '../utility/cache/cache-index';
import type { AuthenticatedIdentity } from './authenticated-owner';

const CACHE_ELIGIBILITY = 'public-derived-v1';
const AUTHORIZATION_LEASE_MS = 0;
const MAX_RENDITION_BYTES = 64 * 1024 ** 2;
const MAX_THUMBNAIL_BYTES = 8 * 1024 ** 2;
const MAX_TILE_BYTES = 8 * 1024 ** 2;
const MAX_IPC_CHUNK_BYTES = 1024 ** 2;

interface CacheBackend {
  acquire(
    keyHash: Buffer,
    namespaceId: string,
    now: number,
  ): Promise<(ReadyCacheEntry & { leaseId: string; filePath: string }) | null>;
  release(leaseId: string): void | Promise<void>;
  beginWrite(input: {
    keyHash: Buffer;
    namespaceId: string;
    assetId: string;
    kind: CacheKind;
    expectedLength: number;
    now: number;
  }): Promise<string>;
  append(writeId: string, chunk: Uint8Array): Promise<void>;
  commit(
    writeId: string,
    metadata: {
      expectedLength: number;
      contentType: string;
      etag: string | null;
      lastModified: string | null;
      verifiedAt: number;
      authorizationLeaseUntil: number;
    },
  ): Promise<void>;
  abort(writeId: string): Promise<void>;
  renewAuthorization(
    keyHash: Buffer,
    namespaceId: string,
    input: {
      verifiedAt: number;
      authorizationLeaseUntil: number;
      etag: string | null;
      lastModified: string | null;
    },
  ): boolean | Promise<boolean>;
  invalidate(keyHash: Buffer): Promise<boolean>;
}

export type MediaResolution =
  | {
      source: 'cache';
      cacheResult: 'LOCAL' | 'REVALIDATED' | 'MISS' | 'COALESCED';
      leaseId: string;
      filePath: string;
      contentType: string;
      logicalBytes: number;
      etag: string | null;
      lastModified: string | null;
    }
  | { source: 'upstream'; response: Response }
  | { source: 'error'; status: number; message: string };

export interface CacheRequestStats {
  localHitCount: number;
  revalidatedHitCount: number;
  missCount: number;
  coalescedCount: number;
  errorCount: number;
  savedBytes: number;
}

export function emptyCacheRequestStats(): CacheRequestStats {
  return {
    localHitCount: 0,
    revalidatedHitCount: 0,
    missCount: 0,
    coalescedCount: 0,
    errorCount: 0,
    savedBytes: 0,
  };
}

type CanReadLocal = (media: DesktopMediaIdentity, identity: AuthenticatedIdentity, file: ReadyCacheEntry) => boolean;

export class MediaCacheController {
  private readonly serverUrl: string;
  private readonly cache: CacheBackend;
  private readonly authenticatedOwner: () => Promise<AuthenticatedIdentity | null>;
  private readonly fetchUpstream: (
    path: string,
    options: { ifNoneMatch?: string; signal?: AbortSignal },
  ) => Promise<Response>;
  private readonly now: () => number;
  private readonly canReadLocal: CanReadLocal;
  private readonly populating = new Map<string, Promise<void>>();
  private readonly requestStats = new Map<string, CacheRequestStats>();

  constructor(options: {
    serverUrl: string;
    cache: CacheBackend;
    authenticatedOwner: () => Promise<AuthenticatedIdentity | null>;
    fetchUpstream: (
      path: string,
      options: { ifNoneMatch?: string; signal?: AbortSignal },
    ) => Promise<Response>;
    now?: () => number;
    canReadLocal?: CanReadLocal;
  }) {
    this.serverUrl = options.serverUrl;
    this.cache = options.cache;
    this.authenticatedOwner = options.authenticatedOwner;
    this.fetchUpstream = options.fetchUpstream;
    this.now = options.now ?? Date.now;
    this.canReadLocal = options.canReadLocal ?? (() => false);
  }

  /** Per media request, for this connection. SQLite acquisitions are internal IO,
   * not evidence that a download or an authorization round trip was avoided. */
  getRequestStats(namespaceId: string): CacheRequestStats {
    return { ...(this.requestStats.get(namespaceId) ?? emptyCacheRequestStats()) };
  }

  async resolve(url: string, signal?: AbortSignal): Promise<MediaResolution> {
    let media: DesktopMediaIdentity;
    try {
      media = parseDesktopMediaUrl(url);
    } catch {
      return { source: 'error', status: 404, message: '媒体地址不存在。' };
    }
    const identity = await this.authenticatedOwner();
    if (!identity) return { source: 'error', status: 401, message: '需要重新登录。' };
    const { ownerId, deploymentId } = identity;

    const namespaceId = buildNamespaceId(this.serverUrl, ownerId, deploymentId, media.libraryMode);
    const keyHash = hashCacheIdentity(
      buildCacheIdentity(this.serverUrl, ownerId, deploymentId, media),
    );
    try {
      const result = await this.resolveAuthorized(media, keyHash, namespaceId, identity, signal);
      this.recordResult(namespaceId, result);
      return result;
    } catch (error) {
      if (!signal?.aborted)
        this.recordResult(namespaceId, { source: 'error', status: 502, message: '' });
      throw error;
    }
  }

  private recordResult(namespaceId: string, result: MediaResolution): void {
    const stats = this.requestStats.get(namespaceId) ?? emptyCacheRequestStats();
    this.requestStats.set(namespaceId, stats);
    if (result.source === 'error' || (result.source === 'upstream' && !result.response.ok))
      stats.errorCount++;
    else if (result.source === 'upstream' || result.cacheResult === 'MISS') stats.missCount++;
    else if (result.cacheResult === 'COALESCED') stats.coalescedCount++;
    else {
      if (result.cacheResult === 'LOCAL') stats.localHitCount++;
      else stats.revalidatedHitCount++;
      stats.savedBytes += result.logicalBytes;
    }
  }

  private async resolveAuthorized(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
    identity: AuthenticatedIdentity,
    signal?: AbortSignal,
  ): Promise<MediaResolution> {
    const now = this.now();
    let existing;
    try {
      existing = await this.cache.acquire(keyHash, namespaceId, now);
    } catch {
      return {
        source: 'upstream',
        response: await this.fetchUpstream(upstreamPath(media), signal ? { signal } : {}),
      };
    }
    try {
      if (existing && this.canReadLocal(media, identity, existing)) return cacheResolution(existing);
      if (existing) {
        await this.cache.release(existing.leaseId);
        return await this.revalidate(media, keyHash, namespaceId, existing, signal);
      }
      return await this.resolveMiss(media, keyHash, namespaceId, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        source: 'upstream',
        response: await this.fetchUpstream(upstreamPath(media), signal ? { signal } : {}),
      };
    }
  }

  private async resolveMiss(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
    signal?: AbortSignal,
  ): Promise<MediaResolution> {
    const keyHex = keyHash.toString('hex');
    const active = this.populating.get(keyHex);
    if (active) {
      await waitForSignal(active, signal);
      const hit = await this.cache.acquire(keyHash, namespaceId, this.now());
      if (hit) return cacheResolution(hit, 'COALESCED');
      return this.resolveMiss(media, keyHash, namespaceId, signal);
    }

    let upstreamResponse: Response | null = null;
    const populate = this.fetchUpstream(upstreamPath(media), signal ? { signal } : {})
      .then(async (response) => {
        if (!isCacheable(response, media) || !response.body) {
          upstreamResponse = response;
          return;
        }
        const result = await this.populateResponse(media, keyHash, namespaceId, response);
        if (result.source === 'cache') await this.cache.release(result.leaseId);
        else if (result.source === 'upstream') upstreamResponse = result.response;
      })
      .finally(() => {
        this.populating.delete(keyHex);
      });
    this.populating.set(keyHex, populate);
    await waitForSignal(populate, signal);
    if (upstreamResponse) return { source: 'upstream', response: upstreamResponse };
    const hit = await this.cache.acquire(keyHash, namespaceId, this.now());
    return hit
      ? cacheResolution(hit, 'MISS')
      : { source: 'error', status: 502, message: '缓存提交后不可用。' };
  }

  private async revalidate(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
    existing: ReadyCacheEntry,
    signal?: AbortSignal,
  ): Promise<MediaResolution> {
    const response = await this.fetchUpstream(upstreamPath(media), {
      ...(existing.etag ? { ifNoneMatch: existing.etag } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 304 && isEligible(response)) {
      const now = this.now();
      await this.cache.renewAuthorization(keyHash, namespaceId, {
        verifiedAt: now,
        authorizationLeaseUntil: now + AUTHORIZATION_LEASE_MS,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      });
      const hit = await this.cache.acquire(keyHash, namespaceId, now);
      return hit
        ? cacheResolution(hit, 'REVALIDATED')
        : { source: 'error', status: 502, message: '缓存重验后不可用。' };
    }

    if (isTransientRevalidationFailure(response.status)) {
      return { source: 'upstream', response };
    }
    await this.cache.invalidate(keyHash);
    if (!isCacheable(response, media)) return { source: 'upstream', response };
    return this.populateResponse(media, keyHash, namespaceId, response);
  }

  private async populateResponse(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
    response: Response,
  ): Promise<MediaResolution> {
    const expectedLength = cacheableLength(response, maximumCacheBytes(media));
    const contentType = response.headers.get('content-type');
    if (expectedLength === null || !contentType || !response.body) {
      return { source: 'upstream', response };
    }
    const now = this.now();
    let writeId: string;
    try {
      writeId = await this.cache.beginWrite({
        keyHash,
        namespaceId,
        assetId: media.assetId,
        kind: media.kind,
        expectedLength,
        now,
      });
    } catch {
      return { source: 'upstream', response };
    }
    try {
      const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += MAX_IPC_CHUNK_BYTES) {
          await this.cache.append(writeId, value.subarray(offset, offset + MAX_IPC_CHUNK_BYTES));
        }
      }
      await this.cache.commit(writeId, {
        expectedLength,
        contentType,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        verifiedAt: now,
        authorizationLeaseUntil: now + AUTHORIZATION_LEASE_MS,
      });
    } catch (error) {
      await this.cache.abort(writeId);
      throw error;
    }
    const hit = await this.cache.acquire(keyHash, namespaceId, this.now());
    return hit
      ? cacheResolution(hit, 'MISS')
      : { source: 'error', status: 502, message: '缓存提交后不可用。' };
  }
}

function isTransientRevalidationFailure(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function waitForSignal(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function upstreamPath(media: DesktopMediaIdentity): string {
  const prefix = media.libraryMode === 'PHOTO' ? '/api/photos' : '/api/eagle';
  if (media.kind === 'RENDITION') {
    return `${prefix}/assets/${encodeURIComponent(media.assetId)}/renditions/${encodeURIComponent(media.renditionId)}`;
  }
  return `${prefix}/assets/${encodeURIComponent(media.assetId)}/pyramids/${encodeURIComponent(media.pyramidId)}/tiles/${media.level}/${media.x}/${media.y}`;
}

function isEligible(response: Response): boolean {
  return response.headers.get('x-sekereagle-desktop-cache') === CACHE_ELIGIBILITY;
}

function isCacheable(response: Response, media: DesktopMediaIdentity): boolean {
  const maximumBytes = maximumCacheBytes(media);
  return (
    response.status === 200 &&
    isEligible(response) &&
    response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() === 'image/webp' &&
    cacheableLength(response, maximumBytes) !== null &&
    response.body !== null
  );
}

function maximumCacheBytes(media: DesktopMediaIdentity): number {
  if (media.kind === 'TILE') return MAX_TILE_BYTES;
  return media.renditionKind === 'THUMBNAIL' ? MAX_THUMBNAIL_BYTES : MAX_RENDITION_BYTES;
}

function cacheableLength(response: Response, maximumBytes = MAX_RENDITION_BYTES): number | null {
  const raw = response.headers.get('content-length');
  if (!raw || !/^[1-9]\d*$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximumBytes ? value : null;
}

function cacheResolution(
  entry: ReadyCacheEntry & { leaseId: string; filePath: string },
  cacheResult: Extract<MediaResolution, { source: 'cache' }>['cacheResult'] = 'LOCAL',
): MediaResolution {
  return {
    source: 'cache',
    cacheResult,
    leaseId: entry.leaseId,
    filePath: entry.filePath,
    contentType: entry.contentType,
    logicalBytes: entry.logicalBytes,
    etag: entry.etag,
    lastModified: entry.lastModified,
  };
}
