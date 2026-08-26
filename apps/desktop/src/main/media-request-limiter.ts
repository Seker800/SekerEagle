interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class MediaRequestLimiter {
  private readonly waiters: Waiter[] = [];
  private active = 0;

  constructor(
    private readonly maximumActive = 6,
    private readonly maximumQueued = 64,
    private readonly queueTimeoutMs = 5_000,
    private readonly totalTimeoutMs = 15_000,
  ) {
    if (!Number.isSafeInteger(maximumActive) || maximumActive < 1) {
      throw new Error('媒体并发上限无效。');
    }
    if (!Number.isSafeInteger(maximumQueued) || maximumQueued < 0) {
      throw new Error('媒体队列上限无效。');
    }
    if (!Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1) {
      throw new Error('媒体排队超时无效。');
    }
    if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < queueTimeoutMs) {
      throw new Error('媒体总超时无效。');
    }
  }

  async fetch(
    factory: (signal: AbortSignal) => Promise<Response>,
    requestSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(abortError(requestSignal));
    requestSignal?.addEventListener('abort', forwardAbort, { once: true });
    const totalTimer = setTimeout(
      () => controller.abort(new Error('媒体请求超过总时间预算。')),
      this.totalTimeoutMs,
    );
    let acquired = false;
    const cleanup = () => {
      clearTimeout(totalTimer);
      requestSignal?.removeEventListener('abort', forwardAbort);
    };

    try {
      await this.acquire(controller.signal);
      acquired = true;
      if (controller.signal.aborted) throw abortError(controller.signal);
      const response = await factory(controller.signal);
      if (!response.body) {
        this.release();
        cleanup();
        return response;
      }
      const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        controller.signal.removeEventListener('abort', cancelReader);
        cleanup();
        this.release();
      };
      const cancelReader = () => {
        void reader.cancel(abortError(controller.signal)).finally(release);
      };
      controller.signal.addEventListener('abort', cancelReader, { once: true });
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const result = await reader.read();
            if (result.done) {
              release();
              stream.close();
            } else {
              stream.enqueue(result.value);
            }
          } catch (error) {
            release();
            stream.error(error);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            release();
          }
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (acquired) this.release();
      cleanup();
      throw error;
    }
  }

  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiters.length };
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (this.active < this.maximumActive) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maximumQueued) {
      return Promise.reject(new Error('媒体请求队列已满。'));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject,
      };
      const removeAndReject = (error: Error) => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        cleanup();
        reject(error);
      };
      const abort = () => removeAndReject(abortError(signal));
      const timer = setTimeout(
        () => removeAndReject(new Error('媒体请求排队超时。')),
        this.queueTimeoutMs,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next.resolve();
    else this.active = Math.max(0, this.active - 1);
  }
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Aborted', 'AbortError');
}
