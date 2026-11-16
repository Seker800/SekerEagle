import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { sha256File } from './upload-dedupe';

// jsdom does not expose SubtleCrypto; use Node's implementation for the WebCrypto path.
vi.stubGlobal('crypto', webcrypto);

const expected = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('hashes small files through WebCrypto', async () => {
  const bytes = new Uint8Array(1024).fill(7);
  expect(await sha256File(new NodeBlob([bytes]) as unknown as File)).toBe(expected(bytes));
});

it('hashes large files in bounded chunks without a whole-file buffer', async () => {
  const bytes = new Uint8Array(33 * 1024 * 1024).fill(11);
  const file = new NodeBlob([bytes]) as unknown as File;
  expect(await sha256File(file)).toBe(expected(bytes));
});

it('stops chunked hashing when the browser session is aborted', async () => {
  const controller = new AbortController();
  const file = new NodeBlob([new Uint8Array(33 * 1024 * 1024)]) as unknown as File;
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await expect(sha256File(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
