import { sha256 } from '@noble/hashes/sha2.js';
import type { EagleUploadContentCheckItem } from './eagle-api';

const HASH_CONCURRENCY = 2;
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const HASH_SMALL_FILE_MAX = 32 * 1024 * 1024;
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
  ) {}
  async check(file: File, signal?: AbortSignal): Promise<UploadDedupeResult> {
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
  // Small files use hardware-accelerated WebCrypto. Large files stream in bounded
  // chunks so RAW and video sizes never require a whole-file buffer.
  if (file.size <= HASH_SMALL_FILE_MAX) {
    const buffer = await file.arrayBuffer();
    signal?.throwIfAborted();
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)));
  }
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const chunk = await file
      .slice(offset, Math.min(file.size, offset + HASH_CHUNK_BYTES))
      .arrayBuffer();
    hash.update(new Uint8Array(chunk));
  }
  signal?.throwIfAborted();
  return toHex(hash.digest());
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Aborted', 'AbortError');
}
