/** Coalesce ready results only; the durable business queue and lease stay authoritative. */
export class FacePublicationBatcher<T> {
  private readonly pending: Array<{
    value: T;
    at: number;
    resolve(): void;
    reject(error: unknown): void;
  }> = [];
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly commit: (values: T[]) => Promise<void>,
    private readonly owner: (value: T) => string,
    private readonly cost: (value: T) => number,
    private readonly delayMs = 200,
  ) {}
  enqueue(value: T): Promise<void> {
    if (this.pending.length >= 32) return Promise.reject(new Error('FACE_PUBLICATION_CAPACITY'));
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ value, at: Date.now(), resolve, reject });
      this.schedule();
    });
  }
  private schedule() {
    if (this.running || !this.pending.length) return;
    clearTimeout(this.timer);
    const delay =
      this.pending.length >= 8 ? 0 : Math.max(0, this.pending[0]!.at + this.delayMs - Date.now());
    this.timer = setTimeout(() => {
      void this.flush();
    }, delay);
  }
  private async flush() {
    if (this.running || !this.pending.length) return;
    this.running = true;
    const batch = [this.pending.shift()!];
    const owner = this.owner(batch[0]!.value);
    let cost = this.cost(batch[0]!.value);
    while (batch.length < 8 && this.pending.length) {
      const next = this.pending[0]!;
      if (this.owner(next.value) !== owner || cost + this.cost(next.value) > 128) break;
      cost += this.cost(next.value);
      batch.push(this.pending.shift()!);
    }
    try {
      await this.commit(batch.map((entry) => entry.value));
      batch.forEach((entry) => entry.resolve());
    } catch (error) {
      batch.forEach((entry) => entry.reject(error));
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
