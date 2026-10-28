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
