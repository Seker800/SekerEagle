import { mkdtemp, mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ORIGINAL_DRAG_EXPORT_TTL_MS,
  OriginalDragExporter,
  parseAssetDragInput,
  parsePreparedDragToken,
} from '../src/main/original-drag-export';

const firstAssetId = '00000000-0000-4000-8000-000000000001';
const secondAssetId = '00000000-0000-4000-8000-000000000002';
const namespaceId = 'a'.repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((directory) =>
        import('node:fs/promises').then(({ rm }) =>
          rm(directory, { recursive: true, force: true }),
        ),
      ),
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-original-drag-test-'));
  temporaryRoots.push(root);
  return root;
}

function originalResponse(bytes: Uint8Array, fileName: string): Response {
  return new Response(bytes, {
    headers: {
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'content-length': String(bytes.byteLength),
      'content-type': 'application/octet-stream',
    },
  });
}

describe('parseAssetDragInput', () => {
  it('accepts a bounded ordered list of unique UUID v4 asset IDs', () => {
    expect(parseAssetDragInput([firstAssetId.toUpperCase(), secondAssetId])).toEqual([
      firstAssetId,
      secondAssetId,
    ]);
  });

  it.each([
    null,
    [],
    [firstAssetId, firstAssetId],
    ['../../etc/passwd'],
    Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    ),
  ])('rejects an unsafe drag payload', (input) => {
    expect(() => parseAssetDragInput(input)).toThrow();
  });
});

describe('parsePreparedDragToken', () => {
  it('accepts only a canonical UUID v4 capability token', () => {
    expect(parsePreparedDragToken(firstAssetId.toUpperCase())).toBe(firstAssetId);
    expect(() => parsePreparedDragToken('../../tmp/original.png')).toThrow();
    expect(() => parsePreparedDragToken('00000000-0000-1000-8000-000000000001')).toThrow();
  });
});

describe('OriginalDragExporter', () => {
  it('streams exact original bytes into an isolated directory and resolves duplicate names', async () => {
    const rootPath = await createRoot();
    const payloads = new Map([
      [firstAssetId, new Uint8Array([1, 2, 3])],
      [secondAssetId, new Uint8Array([4, 5])],
    ]);
    const exporter = new OriginalDragExporter({
      rootPath,
      fetchOriginal: async (assetId) => originalResponse(payloads.get(assetId)!, 'reference.png'),
    });

    const prepared = await exporter.prepare(namespaceId, [firstAssetId, secondAssetId]);

    expect(prepared.files.map((file) => path.basename(file))).toEqual([
      'reference.png',
      'reference (2).png',
    ]);
    expect(new Uint8Array(await readFile(prepared.files[0]))).toEqual(payloads.get(firstAssetId));
    expect(new Uint8Array(await readFile(prepared.files[1]!))).toEqual(payloads.get(secondAssetId));
    if (process.platform !== 'win32') {
      expect((await stat(prepared.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(prepared.files[0])).mode & 0o777).toBe(0o600);
    }
  });

  it('sanitizes server filenames without allowing path traversal or Windows-reserved names', async () => {
    const rootPath = await createRoot();
    const exporter = new OriginalDragExporter({
      rootPath,
      fetchOriginal: async () => originalResponse(new Uint8Array([1]), '../CON?.png'),
    });

    const prepared = await exporter.prepare(namespaceId, [firstAssetId]);

    expect(path.dirname(prepared.files[0])).toBe(prepared.directory);
    expect(path.basename(prepared.files[0])).toBe('_CON_.png');
  });

  it('keeps long Unicode filenames within cross-platform byte limits while preserving extension', async () => {
    const rootPath = await createRoot();
    const exporter = new OriginalDragExporter({
      rootPath,
      fetchOriginal: async () =>
        originalResponse(new Uint8Array([1]), `${'参考图片'.repeat(40)}.png`),
    });

    const prepared = await exporter.prepare(namespaceId, [firstAssetId]);
    const fileName = path.basename(prepared.files[0]);

    expect(Buffer.byteLength(fileName, 'utf8')).toBeLessThanOrEqual(240);
    expect(fileName).toMatch(/\.png$/u);
  });

  it('removes the entire partial export if any authenticated original request fails', async () => {
    const rootPath = await createRoot();
    const exporter = new OriginalDragExporter({
      rootPath,
      fetchOriginal: async (assetId) =>
        assetId === firstAssetId
          ? originalResponse(new Uint8Array([1]), 'first.png')
          : new Response('not found', { status: 404 }),
    });

    await expect(exporter.prepare(namespaceId, [firstAssetId, secondAssetId])).rejects.toThrow(
      '原文件',
    );
    const namespaceEntries = await readdir(path.join(rootPath, namespaceId));
    expect(namespaceEntries).toEqual([]);
  });

  it('deletes expired startup leftovers but preserves recent export directories', async () => {
    const now = Date.UTC(2026, 7, 26, 1, 0, 0);
    const rootPath = await createRoot();
    const accountRoot = path.join(rootPath, namespaceId);
    const oldDirectory = path.join(accountRoot, 'drag-old');
    const recentDirectory = path.join(accountRoot, 'drag-recent');
    await mkdir(oldDirectory, { recursive: true, mode: 0o700 });
    await mkdir(recentDirectory, { mode: 0o700 });
    await writeFile(path.join(oldDirectory, 'old.png'), 'old');
    const expired = new Date(now - ORIGINAL_DRAG_EXPORT_TTL_MS - 1);
    const recent = new Date(now - ORIGINAL_DRAG_EXPORT_TTL_MS + 1);
    await utimes(oldDirectory, expired, expired);
    await utimes(recentDirectory, recent, recent);
    const exporter = new OriginalDragExporter({
      rootPath,
      now: () => now,
      fetchOriginal: async () => originalResponse(new Uint8Array([1]), 'unused.png'),
    });

    await exporter.cleanupExpired();

    await expect(stat(oldDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(recentDirectory)).resolves.toBeDefined();
  });
});
