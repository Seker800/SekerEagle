import { afterEach, expect, it, vi } from 'vitest';
import { readPhotoMetadata } from './photo-editor-metadata';
afterEach(() => vi.unstubAllGlobals());
it('bounds EXIF fetches so metadata cannot block saving forever', async () => {
  const parent = new AbortController();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, options) => {
      requestSignal = options.signal;
      return Promise.reject(new Error('offline'));
    }),
  );
  await expect(readPhotoMetadata('/image', parent.signal)).rejects.toThrow('offline');
  expect(requestSignal).not.toBe(parent.signal);
  parent.abort();
  expect(requestSignal?.aborted).toBe(true);
});
