import type { EagleUploadContentCheckItem } from './eagle-api';

/** Browser hashing buffers one file at a time per slot; larger files fall back to server dedup. */
export const UPLOAD_DEDUPE_MAX_BYTES = 64 * 1024 * 1024;
const HASH_CONCURRENCY = 2;
const BATCH_SIZE = 50;
const FLUSH_DELAY_MS = 80;

export interface UploadDedupeResult {
  sha256: string | null;
  exists: boolean;
}

export class UploadDedupeChecker {
  #pending: Array<{
    item: EagleUploadContentCheckItem;
    signal?: AbortSignal;
    detach: () => void;
    resolve: (exists: boolean) => void;
    reject: (error: unknown) => void;
  }> = [];
  #timer?: ReturnType<typeof setTimeout>;
  #activeHashes = 0;
  #hashWaiters: Array<() => void> = [];
  constructor(
    private readonly checkBatch: (
      items: EagleUploadContentCheckItem[],
      signal?: AbortSignal,
    ) => Promise<boolean[]>,
    private readonly hashFile: (file: File, signal?: AbortSignal) => Promise<string> = sha256File,
    private readonly maxBytes = UPLOAD_DEDUPE_MAX_BYTES,
  ) {}
  async check(file: File, signal?: AbortSignal): Promise<UploadDedupeResult> {
    if (file.size > this.maxBytes) return { sha256: null, exists: false };
    let sha256: string;
    try {
      sha256 = await this.#hash(file, signal);
    } catch (error) {
      // Pre-check is an optimization; never block an upload when the browser cannot hash.
      if (signal?.aborted) throw error;
      return { sha256: null, exists: false };
    }
    const exists = await this.#enqueue({ contentSha256: sha256, size: file.size }, signal);
    return { sha256, exists };
  }
  async #hash(file: File, signal?: AbortSignal) {
    await this.#acquireHashSlot(signal);
    try {
      signal?.throwIfAborted();
      return await this.hashFile(file, signal);
    } finally {
      this.#releaseHashSlot();
    }
  }
  #acquireHashSlot(signal?: AbortSignal) {
    if (this.#activeHashes < HASH_CONCURRENCY) {
      this.#activeHashes += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = () => {
        cleanup();
        this.#activeHashes += 1;
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(abortError(signal));
      };
      const cleanup = () => {
        const index = this.#hashWaiters.indexOf(waiter);
        if (index >= 0) this.#hashWaiters.splice(index, 1);
        signal?.removeEventListener('abort', onAbort);
      };
      this.#hashWaiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  #releaseHashSlot() {
    this.#activeHashes -= 1;
    this.#hashWaiters.shift()?.();
  }
  #enqueue(item: EagleUploadContentCheckItem, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise<boolean>((resolve, reject) => {
      const entry = { item, signal, resolve, reject, detach: (): void => undefined };
      const onAbort = () => {
        const index = this.#pending.indexOf(entry);
        if (index >= 0) this.#pending.splice(index, 1);
        entry.detach();
        reject(abortError(signal));
      };
      entry.detach = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.push(entry);
      if (this.#pending.length >= BATCH_SIZE) this.#flush();
      else this.#timer ??= setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
    });
  }
  #flush() {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const batch = this.#pending.splice(0, BATCH_SIZE);
    if (!batch.length) return;
    if (this.#pending.length) this.#timer = setTimeout(() => this.#flush(), 0);
    Promise.resolve()
      .then(() => this.checkBatch(batch.map((entry) => entry.item)))
      .then((results) => {
        for (const [index, entry] of batch.entries()) {
          entry.detach();
          if (entry.signal?.aborted) entry.reject(abortError(entry.signal));
          else entry.resolve(results[index] === true);
        }
      })
      .catch(() => {
        // Fail open: the server-side publication hash check remains authoritative.
        for (const entry of batch) {
          entry.detach();
          if (entry.signal?.aborted) entry.reject(abortError(entry.signal));
          else entry.resolve(false);
        }
      });
  }
}

export async function sha256File(file: File, signal?: AbortSignal) {
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Aborted', 'AbortError');
}
