/** Bound storage pressure and drain in-flight writes before reporting a failed transfer. */
export async function runTransferWork<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (!failure) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          await work(items[index]!);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
}

/** Process-shared NAS pressure, acquired only around a leaf COPY plus verification. */
export const transferCopyBudget: { run<T>(work: () => Promise<T>): Promise<T> } = new (class {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
})();
