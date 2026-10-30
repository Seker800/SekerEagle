import { expect, it, vi } from 'vitest';
import { streamOriginalToFile, uniqueOriginalFileNames } from './original-download-stream';
const fetchOriginal = vi.hoisted(() => vi.fn());
vi.mock('./api-client', () => ({ fetchWithBrowserSession: fetchOriginal }));
it('streams authenticated chunks with progress and completes only after closing the file', async () => {
  fetchOriginal.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }),
  );
  const write = vi.fn().mockResolvedValue(undefined),
    close = vi.fn().mockResolvedValue(undefined),
    abort = vi.fn();
  const progress = vi.fn();
  await streamOriginalToFile(
    { id: 'a', originalName: 'x.jpg', libraryMode: 'PHOTO' },
    { write, close, abort },
    new AbortController().signal,
    progress,
  );
  expect(fetchOriginal.mock.calls.at(-1)?.[0]).toBe('/api/photos/assets/a/original');
  expect(write).toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(abort).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith(3, 3);
});
it('aborts partial files on truncation or access errors and never reports a successful close', async () => {
  const output = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  fetchOriginal.mockResolvedValue(
    new Response(new Uint8Array([1]), { headers: { 'content-length': '10' } }),
  );
  await expect(
    streamOriginalToFile(
      { id: 'a', originalName: 'a' },
      output,
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow();
  expect(output.close).not.toHaveBeenCalled();
  expect(output.abort).toHaveBeenCalledOnce();
  fetchOriginal.mockResolvedValue(new Response('missing', { status: 404 }));
  await expect(
    streamOriginalToFile(
      { id: 'a', originalName: 'a' },
      output,
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow();
  expect(output.close).not.toHaveBeenCalled();
});
it('resolves traversal, reserved names and case-insensitive duplicate file names within the export folder', () => {
  const names = uniqueOriginalFileNames([
    '../a.jpg',
    '../a.jpg',
    'CON',
    'con',
    'x'.repeat(300) + '.png',
  ]);
  expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(5);
  for (const name of names) {
    expect(name).not.toMatch(/[\\/]/);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(240);
  }
  expect(names[4]).toMatch(/\.png$/);
});
