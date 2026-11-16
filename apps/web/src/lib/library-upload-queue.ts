import { hashKey, type QueryKey } from '@tanstack/react-query';
import { getBrowserSessionSignal } from './api-client';
import type { EagleUploadSessionStatus } from './eagle-api';
import { t } from '../i18n';

export interface EagleUploadItem {
  id: number;
  scope: string;
  name: string;
  size: number;
  percent: number;
  state: 'queued' | 'checking' | 'uploading' | 'uploaded' | 'duplicate' | 'completed' | 'failed';
  phase?: 'validating';
  error?: string;
}
export interface UploadFinalization {
  sessionId: string;
}
export interface UploadOutcome extends Partial<UploadFinalization> {
  duplicate?: boolean;
}
export type UploadProgress = (value: {
  percent: number;
  phase?: 'checking' | 'validating';
}) => void;
export type UploadStatusPoll = (
  sessionIds: string[],
  signal: AbortSignal,
) => Promise<EagleUploadSessionStatus[]>;
type Job = {
  run: (signal: AbortSignal) => Promise<UploadOutcome | void>;
  key: QueryKey;
  pending: boolean;
};
type FinalizationWaiter = { ids: Set<number>; resolve: () => void };

/** Matches the concurrency used by mainstream transfer tools for one browser origin. */
export const UPLOAD_FILE_CONCURRENCY = 4;
const FINALIZATION_POLL_MS = 1_500;
const FINALIZATION_DEADLINE_MS = 10 * 60_000;

/** One observable queue per owner and library, independent of mounted views. */
export class LibraryUploadQueue {
  #items: EagleUploadItem[] = [];
  #jobs = new Map<number, Job>();
  #listeners = new Set<() => void>();
  #nextId = 0;
  #tail = Promise.resolve();
  #controller = new AbortController();
  readonly #session = getBrowserSessionSignal();
  #poll?: UploadStatusPoll;
  #pendingFinalizations = new Map<number, { sessionId: string; deadline: number }>();
  #pollTimer?: ReturnType<typeof setTimeout>;
  #polling = false;
  #waiters: FinalizationWaiter[] = [];
  #active = new Set<number>();
  #releaseRetain?: () => void;
  #paused = false;
  #resumeWaiters: Array<() => void> = [];
  constructor(
    private readonly invalidate: (key: QueryKey) => Promise<unknown>,
    private readonly retain: () => () => void,
  ) {
    this.#session.addEventListener('abort', this.clear, { once: true });
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  snapshot = () => this.#items;
  #publish(items: EagleUploadItem[]) {
    this.#items = items;
    this.#listeners.forEach((listener) => listener());
  }
  #update(id: number, patch: Partial<EagleUploadItem>) {
    this.#publish(this.#items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  clear = () => {
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#jobs.clear();
    this.#active.clear();
    this.#pendingFinalizations.clear();
    this.#paused = false;
    this.#resumeWaiters.splice(0).forEach((resume) => resume());
    this.#resolveWaiters();
    if (this.#pollTimer !== undefined) clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
    this.#releaseRetain?.();
    this.#releaseRetain = undefined;
    this.#publish([]);
  };
  dispose() {
    this.#session.removeEventListener('abort', this.clear);
    this.clear();
  }
  get paused() {
    return this.#paused;
  }
  pauseAll = () => {
    if (this.#paused) return;
    this.#paused = true;
    this.#publish([...this.#items]);
  };
  resumeAll = () => {
    if (!this.#paused) return;
    this.#paused = false;
    this.#resumeWaiters.splice(0).forEach((resume) => resume());
    this.#publish([...this.#items]);
  };
  retryAllFailed = (scope?: string) =>
    this.enqueue(
      this.#items
        .filter((item) => item.state === 'failed' && (!scope || item.scope === scope))
        .map((item) => item.id),
    );
  add(
    files: File[],
    key: QueryKey,
    run: (
      file: File,
      progress: UploadProgress,
      signal: AbortSignal,
    ) => Promise<UploadOutcome | void>,
    poll?: UploadStatusPoll,
  ) {
    this.#session.throwIfAborted();
    if (poll) this.#poll = poll;
    const added = files.map((file) => {
      const id = ++this.#nextId;
      this.#jobs.set(id, {
        pending: false,
        key,
        run: (signal) =>
          run(
            file,
            (progress) =>
              this.#update(
                id,
                progress.phase === 'checking'
                  ? { state: 'checking', percent: 0, phase: undefined }
                  : progress.phase === 'validating'
                    ? { state: 'uploaded', percent: 100, phase: 'validating' }
                    : { state: 'uploading', percent: progress.percent },
              ),
            signal,
          ),
      });
      return {
        id,
        scope: hashKey(key),
        name: file.name,
        size: file.size,
        percent: 0,
        state: 'queued' as const,
      };
    });
    this.#publish([...this.#items, ...added]);
    return this.enqueue(added.map((item) => item.id));
  }
  enqueue = (ids: number[]) => {
    const signal = AbortSignal.any([this.#session, this.#controller.signal]);
    if (signal.aborted) return Promise.resolve();
    const ready = ids.filter((id) => {
      const job = this.#jobs.get(id);
      if (!job || job.pending) return false;
      job.pending = true;
      this.#update(id, { state: 'queued', percent: 0, phase: undefined, error: undefined });
      return true;
    });
    if (!ready.length) return Promise.resolve();
    ready.forEach((id) => this.#active.add(id));
    this.#retainWork();
    const keys = new Map<string, QueryKey>();
    // Upload slots advance as soon as bytes are accepted. Finalization is tracked
    // separately so a queued server-side check never idles a transfer slot.
    const transfer = this.#tail.then(async () => {
      let next = 0;
      const worker = async () => {
        for (;;) {
          await this.#waitWhilePaused(signal);
          if (signal.aborted) return;
          const id = ready[next];
          next += 1;
          if (id === undefined) return;
          const job = this.#jobs.get(id);
          if (!job) continue;
          this.#update(id, { state: 'uploading', percent: 0, phase: undefined });
          try {
            const outcome = await job.run(signal);
            signal.throwIfAborted();
            keys.set(hashKey(job.key), job.key);
            if (outcome?.duplicate) {
              this.#finish(id, 'duplicate');
            } else if (outcome?.sessionId) {
              this.#pendingFinalizations.set(id, {
                sessionId: outcome.sessionId,
                deadline: Date.now() + FINALIZATION_DEADLINE_MS,
              });
              this.#update(id, { state: 'uploaded', percent: 100, phase: undefined });
              this.#schedulePoll();
            } else {
              this.#finish(id, 'completed');
            }
          } catch (error) {
            if (!signal.aborted) this.#finish(id, 'failed', errorMessage(error));
          } finally {
            job.pending = false;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_FILE_CONCURRENCY, ready.length) }, worker),
      );
    });
    this.#tail = transfer.catch(() => undefined);
    const settled = transfer
      .then(() => this.#waitForFinalizations(ready))
      .then(async () => {
        if (!signal.aborted)
          await Promise.all([...keys.values()].map((key) => this.invalidate(key)));
      });
    return settled.finally(() => this.#releaseIfIdle());
  };
  dismiss(scope: string) {
    const ids = new Set(
      this.#items
        .filter(
          (item) =>
            item.scope === scope &&
            (item.state === 'completed' || item.state === 'duplicate' || item.state === 'failed'),
        )
        .map((item) => item.id),
    );
    ids.forEach((id) => this.#jobs.delete(id));
    this.#publish(this.#items.filter((item) => !ids.has(item.id)));
  }
  #finish(id: number, state: 'completed' | 'duplicate' | 'failed', error?: string) {
    this.#pendingFinalizations.delete(id);
    this.#active.delete(id);
    if (state !== 'failed') this.#jobs.delete(id);
    this.#update(id, {
      state,
      ...(state !== 'failed' ? { percent: 100 } : {}),
      ...(error ? { error } : {}),
    });
    // A paused queue with nothing left to transfer must not silently pause new imports later.
    if (!this.#active.size && this.#paused) {
      this.#paused = false;
      this.#resumeWaiters.splice(0).forEach((resume) => resume());
      this.#publish([...this.#items]);
    }
  }
  #waitWhilePaused(signal: AbortSignal) {
    if (!this.#paused) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const resume = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        const index = this.#resumeWaiters.indexOf(resume);
        if (index >= 0) this.#resumeWaiters.splice(index, 1);
        signal.removeEventListener('abort', onAbort);
      };
      this.#resumeWaiters.push(resume);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  #waitForFinalizations(ids: number[]) {
    if (!ids.some((id) => this.#pendingFinalizations.has(id))) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#waiters.push({ ids: new Set(ids), resolve });
    });
  }
  #resolveWaiters() {
    this.#waiters = this.#waiters.filter((waiter) => {
      if ([...waiter.ids].some((id) => this.#pendingFinalizations.has(id))) return true;
      waiter.resolve();
      return false;
    });
  }
  #retainWork() {
    if (!this.#releaseRetain) this.#releaseRetain = this.retain();
  }
  #releaseIfIdle() {
    if (this.#active.size || !this.#releaseRetain) return;
    this.#releaseRetain();
    this.#releaseRetain = undefined;
  }
  #schedulePoll() {
    if (this.#pollTimer !== undefined || this.#polling) return;
    if (!this.#poll || !this.#pendingFinalizations.size) return;
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = undefined;
      void this.#pollPending();
    }, FINALIZATION_POLL_MS);
  }
  async #pollPending() {
    if (this.#polling || !this.#poll || !this.#pendingFinalizations.size) return;
    const signal = AbortSignal.any([this.#session, this.#controller.signal]);
    if (signal.aborted) return;
    this.#polling = true;
    try {
      const entries = [...this.#pendingFinalizations.entries()];
      const statuses = await this.#poll(
        entries.map(([, pending]) => pending.sessionId),
        signal,
      );
      const byId = new Map(statuses.map((status) => [status.id, status]));
      for (const [itemId, pending] of entries) {
        if (!this.#pendingFinalizations.has(itemId)) continue;
        const status = byId.get(pending.sessionId);
        if (status?.status === 'COMPLETED' && status.eagleAssetId) {
          this.#finish(itemId, status.objectCleanupPending ? 'duplicate' : 'completed');
        } else if (status?.status === 'ABORTED') {
          this.#finish(itemId, 'failed', status.lastError || t('上传文件校验已取消。'));
        } else if (
          status?.status === 'FAILED' &&
          ((status.finalizationAttempts ?? 0) >= 10 || status.objectCleanupPending)
        ) {
          this.#finish(itemId, 'failed', status.lastError || t('上传文件校验失败。'));
        } else if (Date.now() >= pending.deadline) {
          this.#finish(itemId, 'failed', t('服务器仍在确认入库，请稍后在图库中查看。'));
        }
      }
    } catch {
      // Transient poll failures retry on the next tick; the deadline bounds the wait.
    } finally {
      this.#polling = false;
      this.#resolveWaiters();
      if (this.#pendingFinalizations.size) this.#schedulePoll();
      else this.#releaseIfIdle();
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : t('导入失败');
}
