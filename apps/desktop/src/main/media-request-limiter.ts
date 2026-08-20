export class MediaRequestLimiter {
  private readonly waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private active = 0;

  constructor(
    private readonly maximumActive = 6,
    private readonly maximumQueued = 64,
  ) {
    if (!Number.isSafeInteger(maximumActive) || maximumActive < 1) {
      throw new Error('媒体并发上限无效。');
    }
    if (!Number.isSafeInteger(maximumQueued) || maximumQueued < 0) {
      throw new Error('媒体队列上限无效。');
    }
  }

  async fetch(factory: () => Promise<Response>): Promise<Response> {
    await this.acquire();
    try {
      const response = await factory();
      if (!response.body) {
        this.release();
        return response;
      }
      const reader = response.body.getReader();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.release();
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) {
              release();
              controller.close();
            } else {
              controller.enqueue(result.value);
            }
          } catch (error) {
            release();
            controller.error(error);
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
      this.release();
      throw error;
    }
  }

  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiters.length };
  }

  private acquire(): Promise<void> {
    if (this.active < this.maximumActive) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maximumQueued) {
      return Promise.reject(new Error('媒体请求队列已满。'));
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next.resolve();
    else this.active = Math.max(0, this.active - 1);
  }
}
