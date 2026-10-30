export class ConcurrentWorkError<T, R> extends Error {
  constructor(
    cause: unknown,
    readonly completed: Array<{ item: T; result: R }>,
    readonly retryItems: T[],
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ConcurrentWorkError';
  }
}
/** Stop claiming on first failure; callers observe failure only after all writes settle. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  const committed = new Set<number>();
  const workerCount = Math.min(
    items.length,
    Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1),
  );
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!failed && nextIndex < items.length) {
        const index = nextIndex++;
        try {
          results[index] = await worker(items[index], index);
          committed.add(index);
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
    }),
  );
  if (failed)
    throw new ConcurrentWorkError(
      firstError,
      items.flatMap((item, index) =>
        committed.has(index) ? [{ item, result: results[index] }] : [],
      ),
      items.filter((_, index) => !committed.has(index)),
    );
  return results;
}
