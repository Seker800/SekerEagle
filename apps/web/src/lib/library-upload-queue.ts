import { hashKey, type QueryKey } from '@tanstack/react-query';
import { mapWithConcurrency } from './async-pool';
import { getBrowserSessionSignal } from './api-client';
import { t } from '../i18n';

export interface EagleUploadItem {
  id: number;
  scope: string;
  name: string;
  size: number;
  percent: number;
  state: 'queued' | 'uploading' | 'completed' | 'failed';
  error?: string;
}
type Job = {
  run: (signal: AbortSignal) => Promise<unknown>;
  key: QueryKey;
  pending: boolean;
};
/** One observable queue per owner and library, independent of mounted views. */
export class LibraryUploadQueue {
  #items: EagleUploadItem[] = [];
  #jobs = new Map<number, Job>();
  #listeners = new Set<() => void>();
  #nextId = 0;
  #tail = Promise.resolve();
  #controller = new AbortController();
  readonly #session = getBrowserSessionSignal();
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
    this.#publish([]);
  };
  dispose() {
    this.#session.removeEventListener('abort', this.clear);
    this.clear();
  }
  add(
    files: File[],
    key: QueryKey,
    run: (
      file: File,
      progress: (value: { percent: number }) => void,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {
    this.#session.throwIfAborted();
    const added = files.map((file) => {
      const id = ++this.#nextId;
      this.#jobs.set(id, {
        pending: false,
        key,
        run: (signal) =>
          run(file, (progress) => this.#update(id, { percent: progress.percent }), signal),
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
      this.#update(id, { state: 'queued', percent: 0, error: undefined });
      return true;
    });
    if (!ready.length) return Promise.resolve();
    const release = this.retain();
    const pending = this.#tail
      .then(async () => {
        const keys = new Map<string, QueryKey>();
        await mapWithConcurrency(ready, 2, async (id) => {
          const job = this.#jobs.get(id);
          if (signal.aborted || !job) return;
          this.#update(id, { state: 'uploading' });
          try {
            await job.run(signal);
            signal.throwIfAborted();
            this.#update(id, { state: 'completed', percent: 100 });
            this.#jobs.delete(id);
            keys.set(hashKey(job.key), job.key);
          } catch (error) {
            if (!signal.aborted)
              this.#update(id, {
                state: 'failed',
                error: error instanceof Error ? error.message : t('导入失败'),
              });
          } finally {
            job.pending = false;
          }
        });
        if (!signal.aborted) await Promise.all([...keys.values()].map(this.invalidate));
      })
      .finally(release);
    this.#tail = pending.catch(() => undefined);
    return pending;
  };
  dismiss(scope: string) {
    const ids = new Set(
      this.#items
        .filter(
          (item) => item.scope === scope && (item.state === 'completed' || item.state === 'failed'),
        )
        .map((item) => item.id),
    );
    ids.forEach((id) => this.#jobs.delete(id));
    this.#publish(this.#items.filter((item) => !ids.has(item.id)));
  }
}
