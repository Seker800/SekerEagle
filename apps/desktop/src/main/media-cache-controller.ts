import {
  buildCacheIdentity,
  buildNamespaceId,
  hashCacheIdentity,
  parseDesktopMediaUrl,
  type DesktopMediaIdentity,
} from '../shared/media-identity';
import type { CacheKind, ReadyCacheEntry } from '../utility/cache/cache-index';

const CACHE_ELIGIBILITY = 'public-derived-v1';
const AUTHORIZATION_LEASE_MS = 5 * 60_000;
const MAX_CACHEABLE_MEDIA_BYTES = 64 * 1024 ** 2;
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
      leaseId: string;
      filePath: string;
      contentType: string;
      logicalBytes: number;
      etag: string | null;
      lastModified: string | null;
    }
  | { source: 'upstream'; response: Response }
  | { source: 'error'; status: number; message: string };

export class MediaCacheController {
  private readonly serverUrl: string;
  private readonly cache: CacheBackend;
  private readonly authenticatedOwner: () => Promise<string | null>;
  private readonly fetchUpstream: (
    path: string,
    options: { ifNoneMatch?: string },
  ) => Promise<Response>;
  private readonly now: () => number;
  private readonly populating = new Map<string, Promise<Response | null>>();

  constructor(options: {
    serverUrl: string;
    cache: CacheBackend;
    authenticatedOwner: () => Promise<string | null>;
    fetchUpstream: (path: string, options: { ifNoneMatch?: string }) => Promise<Response>;
    now?: () => number;
  }) {
    this.serverUrl = options.serverUrl;
    this.cache = options.cache;
    this.authenticatedOwner = options.authenticatedOwner;
    this.fetchUpstream = options.fetchUpstream;
    this.now = options.now ?? Date.now;
  }

  async resolve(url: string): Promise<MediaResolution> {
    let media: DesktopMediaIdentity;
    try {
      media = parseDesktopMediaUrl(url);
    } catch {
      return { source: 'error', status: 404, message: '媒体地址不存在。' };
    }
    const ownerId = await this.authenticatedOwner();
    if (!ownerId) return { source: 'error', status: 401, message: '需要重新登录。' };

    const namespaceId = buildNamespaceId(this.serverUrl, ownerId);
    const keyHash = hashCacheIdentity(buildCacheIdentity(this.serverUrl, ownerId, media));
    const now = this.now();
    const existing = await this.cache.acquire(keyHash, namespaceId, now);
    if (existing && existing.authorizationLeaseUntil >= now) return cacheResolution(existing);
    if (existing) {
      await this.cache.release(existing.leaseId);
      return this.revalidate(media, keyHash, namespaceId, existing);
    }
    return this.resolveMiss(media, keyHash, namespaceId);
  }

  private async resolveMiss(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
  ): Promise<MediaResolution> {
    const keyHex = keyHash.toString('hex');
    const active = this.populating.get(keyHex);
    if (active) {
      await active;
      const hit = await this.cache.acquire(keyHash, namespaceId, this.now());
      if (hit) return cacheResolution(hit);
      return this.resolveMiss(media, keyHash, namespaceId);
    }

    const populate = this.fetchAndPopulate(media, keyHash, namespaceId);
    this.populating.set(keyHex, populate);
    try {
      const upstream = await populate;
      if (upstream) return { source: 'upstream', response: upstream };
      const hit = await this.cache.acquire(keyHash, namespaceId, this.now());
      return hit
        ? cacheResolution(hit)
        : { source: 'error', status: 502, message: '缓存提交后不可用。' };
    } finally {
      this.populating.delete(keyHex);
    }
  }

  private async revalidate(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
    existing: ReadyCacheEntry,
  ): Promise<MediaResolution> {
    const response = await this.fetchUpstream(upstreamPath(media), {
      ...(existing.etag ? { ifNoneMatch: existing.etag } : {}),
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
        ? cacheResolution(hit)
        : { source: 'error', status: 502, message: '缓存重验后不可用。' };
    }

    await this.cache.invalidate(keyHash);
    if (!isCacheable(response)) return { source: 'upstream', response };
    return this.populateResponse(media, keyHash, namespaceId, response);
  }

  private async fetchAndPopulate(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
  ): Promise<Response | null> {
    const response = await this.fetchUpstream(upstreamPath(media), {});
    if (!isCacheable(response)) return response;
    const result = await this.populateResponse(media, keyHash, namespaceId, response);
    if (result.source === 'cache') await this.cache.release(result.leaseId);
    return result.source === 'upstream' ? result.response : null;
  }

  private async populateResponse(
    media: DesktopMediaIdentity,
    keyHash: Buffer,
    namespaceId: string,
    response: Response,
  ): Promise<MediaResolution> {
    const expectedLength = cacheableLength(response);
    const contentType = response.headers.get('content-type');
    if (expectedLength === null || !contentType || !response.body) {
      return { source: 'upstream', response };
    }
    const now = this.now();
    const writeId = await this.cache.beginWrite({
      keyHash,
      namespaceId,
      assetId: media.assetId,
      kind: media.kind,
      now,
    });
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
      ? cacheResolution(hit)
      : { source: 'error', status: 502, message: '缓存提交后不可用。' };
  }
}

function upstreamPath(media: DesktopMediaIdentity): string {
  if (media.kind === 'RENDITION') {
    return `/api/eagle/assets/${encodeURIComponent(media.assetId)}/renditions/${encodeURIComponent(media.renditionId)}`;
  }
  return `/api/eagle/assets/${encodeURIComponent(media.assetId)}/pyramids/${encodeURIComponent(media.pyramidId)}/tiles/${media.level}/${media.x}/${media.y}`;
}

function isEligible(response: Response): boolean {
  return response.headers.get('x-sekereagle-desktop-cache') === CACHE_ELIGIBILITY;
}

function isCacheable(response: Response): boolean {
  return (
    response.status === 200 &&
    isEligible(response) &&
    response.headers.get('content-type')?.toLowerCase().startsWith('image/') === true &&
    cacheableLength(response) !== null &&
    response.body !== null
  );
}

function cacheableLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (!raw || !/^[1-9]\d*$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= MAX_CACHEABLE_MEDIA_BYTES ? value : null;
}

function cacheResolution(
  entry: ReadyCacheEntry & { leaseId: string; filePath: string },
): MediaResolution {
  return {
    source: 'cache',
    leaseId: entry.leaseId,
    filePath: entry.filePath,
    contentType: entry.contentType,
    logicalBytes: entry.logicalBytes,
    etag: entry.etag,
    lastModified: entry.lastModified,
  };
}
