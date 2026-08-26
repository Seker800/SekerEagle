export type MediaLoadPriority = 'immediate' | 'visible' | 'prefetch';

export interface MediaLoadTask {
  id: string;
  priority: MediaLoadPriority;
  order: number;
  run: (signal: AbortSignal) => Promise<void>;
}

interface QueuedTask extends MediaLoadTask {
  sequence: number;
}

interface ActiveTask {
  controller: AbortController;
  sequence: number;
}

const priorityRank: Record<MediaLoadPriority, number> = {
  immediate: 0,
  visible: 1,
  prefetch: 2,
};

export function getRecommendedMediaConcurrency(): number {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (
    connection?.saveData ||
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g'
  ) {
    return 2;
  }
  if (!connection) return 3;
  return 4;
}

export class MediaLoadScheduler {
  private readonly maxConcurrent: number;
  private readonly startsPerMillisecond: number;
  private readonly burst: number;
  private readonly queue = new Map<string, QueuedTask>();
  private readonly active = new Map<string, ActiveTask>();
  private sequence = 0;
  private flushScheduled = false;
  private availableTokens: number;
  private lastRefillAt = performance.now();
  private rateWakeTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownUntil = 0;

  constructor({
    maxConcurrent = getRecommendedMediaConcurrency(),
    startsPerSecond = 32,
    burst = 16,
  }: { maxConcurrent?: number; startsPerSecond?: number; burst?: number } = {}) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.startsPerMillisecond = Math.max(1, startsPerSecond) / 1_000;
    this.burst = Math.max(1, Math.floor(burst));
    this.availableTokens = this.burst;
  }

  enqueue(task: MediaLoadTask): () => void {
    const queuedTask = { ...task, sequence: this.sequence++ };
    this.queue.set(task.id, queuedTask);
    this.scheduleFlush();

    return () => {
      if (this.queue.get(task.id)?.sequence === queuedTask.sequence) {
        this.queue.delete(task.id);
      }
      const activeTask = this.active.get(task.id);
      if (activeTask?.sequence === queuedTask.sequence) {
        activeTask.controller.abort();
      }
    };
  }

  clear({ abortActive = false }: { abortActive?: boolean } = {}) {
    this.queue.clear();
    this.clearRateWake();
    if (abortActive) {
      for (const task of this.active.values()) task.controller.abort();
    }
  }

  coolDown(delayMs: number) {
    this.cooldownUntil = Math.max(this.cooldownUntil, performance.now() + Math.max(0, delayMs));
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush() {
    while (this.active.size < this.maxConcurrent && this.queue.size > 0) {
      const next = [...this.queue.values()]
        .filter((task) => !this.active.has(task.id))
        .sort((left, right) => {
          const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
          if (priorityDifference !== 0) return priorityDifference;
          const orderDifference = right.order - left.order;
          if (orderDifference !== 0) return orderDifference;
          return left.sequence - right.sequence;
        })[0];
      if (!next) return;
      if (!this.consumeStartToken()) return;
      this.queue.delete(next.id);
      const controller = new AbortController();
      const activeTask = { controller, sequence: next.sequence };
      this.active.set(next.id, activeTask);
      void next
        .run(controller.signal)
        .catch(() => undefined)
        .finally(() => {
          if (this.active.get(next.id) === activeTask) {
            this.active.delete(next.id);
          }
          this.scheduleFlush();
        });
    }
  }

  private consumeStartToken(): boolean {
    const now = performance.now();
    const elapsed = Math.max(0, now - this.lastRefillAt);
    this.availableTokens = Math.min(
      this.burst,
      this.availableTokens + elapsed * this.startsPerMillisecond,
    );
    this.lastRefillAt = now;

    if (now < this.cooldownUntil) {
      this.scheduleRateWake(this.cooldownUntil - now);
      return false;
    }
    if (this.availableTokens < 1) {
      this.scheduleRateWake((1 - this.availableTokens) / this.startsPerMillisecond);
      return false;
    }
    this.availableTokens -= 1;
    return true;
  }

  private scheduleRateWake(delayMs: number) {
    if (this.rateWakeTimer !== null) return;
    this.rateWakeTimer = setTimeout(
      () => {
        this.rateWakeTimer = null;
        this.scheduleFlush();
      },
      Math.max(1, Math.ceil(delayMs)),
    );
  }

  private clearRateWake() {
    if (this.rateWakeTimer === null) return;
    clearTimeout(this.rateWakeTimer);
    this.rateWakeTimer = null;
  }
}
