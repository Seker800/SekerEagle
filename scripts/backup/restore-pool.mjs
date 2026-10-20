// Restore-only pool: bound file streams and writes, and drain before closing S3.
export async function runRestorePool(
  items,
  restore,
  { concurrency = 1, onProgress = () => {} } = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('Restore concurrency must be an integer between 1 and 8');
  }
  let next = 0;
  let completed = 0;
  let failure;
  async function run() {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await restore(item);
        onProgress(++completed);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  if (failure) throw failure;
}
