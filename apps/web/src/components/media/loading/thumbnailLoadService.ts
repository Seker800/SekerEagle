import { fetchWithBrowserSession } from '../../../lib/api-client';

export type ThumbnailLoadFailure =
  'not-found' | 'rate-limited' | 'transient' | 'unauthorized' | 'invalid-response';

export class ThumbnailLoadError extends Error {
  constructor(
    readonly failure: ThumbnailLoadFailure,
    readonly retryAfterMs = 0,
    options?: ErrorOptions,
  ) {
    super(`thumbnail_load_${failure}`, options);
    this.name = 'ThumbnailLoadError';
  }
}

export interface LoadedThumbnail {
  url: string;
  release(): void;
}

interface InFlightLoad {
  controller: AbortController;
  waiters: number;
  promise: Promise<Blob>;
}

interface ObjectUrlEntry {
  url: string;
  references: number;
  byteSize: number;
  lastAccessedAt: number;
  accessOrder: number;
}

export interface ThumbnailCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  maxIdleMs?: number;
}

const DEFAULT_MAX_ENTRIES = 2_048;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_IDLE_MS = 30 * 60_000;

export class ThumbnailLoadService {
  private readonly inFlight = new Map<string, InFlightLoad>();
  private readonly objectUrls = new Map<string, ObjectUrlEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxIdleMs: number;
  private totalBytes = 0;
  private accessOrder = 0;

  constructor(options: ThumbnailCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxIdleMs = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
  }

  async load(key: string, url: string, signal: AbortSignal): Promise<LoadedThumbnail> {
    this.evictExpired();
    const cached = this.objectUrls.get(key);
    if (cached) return this.retain(key, cached);

    let load = this.inFlight.get(key);
    if (!load) {
      const controller = new AbortController();
      load = {
        controller,
        waiters: 0,
        promise: this.fetchBlob(url, controller.signal).finally(() => {
          if (this.inFlight.get(key)?.controller === controller) this.inFlight.delete(key);
        }),
      };
      this.inFlight.set(key, load);
    }

    load.waiters += 1;
    let blob: Blob;
    try {
      blob = await waitForLoad(load.promise, signal);
    } finally {
      load.waiters -= 1;
      if (load.waiters === 0) load.controller.abort();
    }

    if (signal.aborted) throw abortError(signal);
    const existing = this.objectUrls.get(key);
    if (existing) return this.retain(key, existing);
    const created = {
      url: URL.createObjectURL(blob),
      references: 0,
      byteSize: blob.size,
      lastAccessedAt: Date.now(),
      accessOrder: ++this.accessOrder,
    };
    this.objectUrls.set(key, created);
    this.totalBytes += created.byteSize;
    const loaded = this.retain(key, created);
    this.evictToLimits();
    return loaded;
  }

  dispose(): void {
    for (const load of this.inFlight.values()) load.controller.abort();
    this.inFlight.clear();
    for (const entry of this.objectUrls.values()) URL.revokeObjectURL(entry.url);
    this.objectUrls.clear();
    this.totalBytes = 0;
  }

  private retain(key: string, entry: ObjectUrlEntry): LoadedThumbnail {
    entry.references += 1;
    this.touch(entry);
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        entry.references -= 1;
        if (this.objectUrls.get(key) !== entry) return;
        this.touch(entry);
        this.evictExpired();
        this.evictToLimits();
      },
    };
  }

  private touch(entry: ObjectUrlEntry): void {
    entry.lastAccessedAt = Date.now();
    entry.accessOrder = ++this.accessOrder;
  }

  private evictExpired(): void {
    if (!Number.isFinite(this.maxIdleMs)) return;
    const deadline = Date.now() - this.maxIdleMs;
    for (const [key, entry] of this.objectUrls) {
      if (entry.references === 0 && entry.lastAccessedAt <= deadline) this.evict(key, entry);
    }
  }

  private evictToLimits(): void {
    while (this.objectUrls.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      let oldest: [string, ObjectUrlEntry] | undefined;
      for (const candidate of this.objectUrls) {
        if (candidate[1].references > 0) continue;
        if (!oldest || candidate[1].accessOrder < oldest[1].accessOrder) oldest = candidate;
      }
      if (!oldest) return;
      this.evict(oldest[0], oldest[1]);
    }
  }

  private evict(key: string, entry: ObjectUrlEntry): void {
    if (this.objectUrls.get(key) !== entry) return;
    this.objectUrls.delete(key);
    this.totalBytes -= entry.byteSize;
    URL.revokeObjectURL(entry.url);
  }

  private async fetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
    let response: Response;
    try {
      response = await fetchWithBrowserSession(url, { signal });
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      throw new ThumbnailLoadError('transient', 500, { cause: error });
    }

    if (response.status === 404 || response.status === 410) {
      throw new ThumbnailLoadError('not-found');
    }
    if (response.status === 429) {
      throw new ThumbnailLoadError('rate-limited', parseRetryAfter(response.headers));
    }
    if (response.status === 401 || response.status === 403) {
      throw new ThumbnailLoadError('unauthorized');
    }
    if (response.status >= 500) {
      throw new ThumbnailLoadError('transient', parseRetryAfter(response.headers));
    }
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      throw new ThumbnailLoadError('invalid-response');
    }
    return response.blob();
  }
}

function waitForLoad(load: Promise<Blob>, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    load.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function parseRetryAfter(headers: Headers): number {
  const value = headers.get('retry-after');
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(1_000, deadline - Date.now()) : 1_000;
}
