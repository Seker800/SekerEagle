import { File as NodeFile } from 'node:buffer';
import { encode } from 'fast-png';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importPhotoLut, listPhotoLuts, loadPhotoLut } from './photo-lut-storage';
const personalLuts = async () =>
  (await listPhotoLuts()).filter((entry) => !entry.id.startsWith('bundled-'));
const identity =
  'LUT_3D_SIZE 2\n' +
  Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1].join(' ')).join('\n');
const file = (text: string, name = 'Identity.cube') =>
  new NodeFile([text], name) as unknown as File;
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('persists tables and metadata atomically, deduplicates content and loads by immutable id', async () => {
  expect(await personalLuts()).toEqual([]);
  const entry = await importPhotoLut(file(identity));
  await importPhotoLut(file(identity));
  expect(await personalLuts()).toEqual([entry]);
  const table = await loadPhotoLut(entry.id);
  expect(table.size).toBe(2);
  expect(ArrayBuffer.isView(table.data)).toBe(true);
  expect(table.data.BYTES_PER_ELEMENT).toBe(4);
  await expect(loadPhotoLut('missing')).rejects.toThrow('LUT_NOT_FOUND');
  await importPhotoLut(file(identity + '\n# second', 'Another.cube'));
  expect((await personalLuts()).map((e) => e.name)).toEqual(['Another', 'Identity']);
});
it('rejects empty, oversized, unsupported and malformed files without changing the library', async () => {
  for (const value of [
    file(''),
    file('bad'),
    file(identity, 'wrong.txt'),
    file('not a png file with enough bytes to have a header', 'bad.png'),
    file('x'.repeat(16 * 1024 * 1024 + 1)),
  ])
    await expect(importPhotoLut(value)).rejects.toThrow();
  expect(await personalLuts()).toEqual([]);
});
it('imports raw RGB even with alpha, validates dimensions and rejects corrupted PNGs', async () => {
  const data = new Uint8Array(64 * 64 * 4);
  for (let p = 0; p < data.length; p += 4) data.set([97, 125, 183, 230], p);
  const png = encode({ width: 64, height: 64, data, channels: 4, depth: 8 });
  const entry = await importPhotoLut(new NodeFile([png], 'Table.png') as unknown as File);
  const table = await loadPhotoLut(entry.id);
  expect(entry.size).toBe(16);
  expect(table.data[0]).toBeCloseTo(97 / 255, 7);
  const invalid = Buffer.from(png);
  invalid.writeUInt32BE(99999, 16);
  await expect(
    importPhotoLut(new NodeFile([invalid], 'Bad.png') as unknown as File),
  ).rejects.toThrow();
  const corrupt = Buffer.from(png);
  corrupt[corrupt.length - 5] ^= 1;
  await expect(
    importPhotoLut(new NodeFile([corrupt], 'Corrupt.png') as unknown as File),
  ).rejects.toThrow();
});

it('reports storage unavailability instead of claiming a successful import', async () => {
  vi.stubGlobal('indexedDB', {
    open() {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => request.onerror?.(new Event('error')));
      return request;
    },
  });
  await expect(importPhotoLut(file(identity))).rejects.toThrow('LUT_STORAGE_UNAVAILABLE');
  await expect(listPhotoLuts()).rejects.toThrow('LUT_STORAGE_UNAVAILABLE');
});

it('updates local grouping by content id and retains it when reimporting an ordinary filename', async () => {
  const grouped = await importPhotoLut(file(identity, '01-Priority__02-Favorite.cube'));
  expect(grouped).toMatchObject({ name: 'Favorite', group: 'Priority', groupOrder: 1, order: 2 });
  const before = await loadPhotoLut(grouped.id);
  const ordinary = await importPhotoLut(file(identity));
  expect(ordinary.id).toBe(grouped.id);
  expect(await personalLuts()).toEqual([
    expect.objectContaining({ id: grouped.id, group: 'Priority', groupOrder: 1, order: 2 }),
  ]);
  expect((await loadPhotoLut(grouped.id)).data).toEqual(before.data);
});

it('ships fourteen Leica LUTs and keeps personal imports independent of bundled versions', async () => {
  const bundled = (await listPhotoLuts()).filter((entry) => entry.id.startsWith('bundled-'));
  expect(bundled).toHaveLength(14);
  expect(new Set(bundled.map((entry) => entry.id)).size).toBe(14);
  expect(bundled.every((entry) => entry.size === 64 && entry.group === '徕卡')).toBe(true);
  const personal = await importPhotoLut(file(identity));
  expect(await listPhotoLuts()).toEqual(expect.arrayContaining([...bundled, personal]));
  expect((await loadPhotoLut(personal.id)).data[0]).toBe(0);
});
