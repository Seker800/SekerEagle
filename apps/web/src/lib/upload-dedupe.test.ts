import { expect, it, vi } from 'vitest';
import { UploadDedupeChecker } from './upload-dedupe';
import type { EagleUploadContentCheckItem } from './eagle-api';

const file = (name: string, size = 4) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

it('hashes and checks nearby files in one batch request', async () => {
  const batch = vi.fn(async (items: EagleUploadContentCheckItem[]) => items.map(() => false));
  const checker = new UploadDedupeChecker(batch, async () => 'a'.repeat(64));
  const [first, second] = await Promise.all([
    checker.check(file('a.jpg')),
    checker.check(file('b.jpg')),
  ]);
  expect(batch).toHaveBeenCalledOnce();
  expect(batch.mock.calls[0]![0]).toEqual([
    { contentSha256: 'a'.repeat(64), size: 4 },
    { contentSha256: 'a'.repeat(64), size: 4 },
  ]);
  expect(first).toEqual({ sha256: 'a'.repeat(64), exists: false });
  expect(second).toEqual({ sha256: 'a'.repeat(64), exists: false });
});

it('skips pre-check for files above the browser memory bound', async () => {
  const batch = vi.fn(async () => [true]);
  const hash = vi.fn(async () => 'a'.repeat(64));
  const checker = new UploadDedupeChecker(batch, hash, 3);
  expect(await checker.check(file('raw.dng', 4))).toEqual({ sha256: null, exists: false });
  expect(hash).not.toHaveBeenCalled();
  expect(batch).not.toHaveBeenCalled();
});

it('fails open when the browser cannot hash the file', async () => {
  const checker = new UploadDedupeChecker(
    async () => [true],
    async () => {
      throw new Error('crypto unavailable');
    },
  );
  expect(await checker.check(file('e.jpg'))).toEqual({ sha256: null, exists: false });
});

it('fails open so the server-side publication check remains authoritative', async () => {
  const checker = new UploadDedupeChecker(
    async () => {
      throw new Error('network down');
    },
    async () => 'b'.repeat(64),
  );
  expect(await checker.check(file('c.jpg'))).toEqual({ sha256: 'b'.repeat(64), exists: false });
});

it('stops hashing when the browser session is aborted', async () => {
  const controller = new AbortController();
  const checker = new UploadDedupeChecker(
    async () => [false],
    async () => 'c'.repeat(64),
  );
  const pending = checker.check(file('d.jpg'), controller.signal);
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
