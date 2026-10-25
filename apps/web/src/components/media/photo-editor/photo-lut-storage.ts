import bundled from './bundled-luts/manifest.json';
const bundledUrls = import.meta.glob('./bundled-luts/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
import { decode } from 'fast-png';
import { photoLutFileName } from './photo-lut-groups';
import { parseCubeLut, parsePngLut, pngLutLayout, type PhotoLut } from './photo-lut';
export interface PhotoLutEntry {
  id: string;
  name: string;
  size: number;
  group?: string;
  groupOrder?: number;
  order?: number;
}
const database = 'sekereagle-personal-luts-v1';
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('entries', { keyPath: 'id' });
      request.result.createObjectStore('tables');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('LUT_STORAGE_UNAVAILABLE'));
  });
}
export async function listPhotoLuts(): Promise<PhotoLutEntry[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('entries').objectStore('entries').getAll();
      req.onsuccess = () =>
        resolve(
          [...bundled, ...(req.result as PhotoLutEntry[])].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      req.onerror = () => reject(new Error('LUT_STORAGE_UNAVAILABLE'));
    });
  } finally {
    db.close();
  }
}
export async function loadPhotoLut(id: string): Promise<PhotoLut> {
  const builtin = bundled.find((entry) => entry.id === id);
  if (builtin) {
    const response = await fetch(bundledUrls[`./bundled-luts/${builtin.file}`]);
    if (!response.ok) throw new Error('LUT_NOT_FOUND');
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (
      Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
        '',
      ) !== builtin.sha256
    )
      throw new Error('INVALID_LUT');
    return decodeFile({ name: builtin.file } as File, bytes);
  }
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('tables').objectStore('tables').get(id);
      req.onsuccess = () =>
        req.result ? resolve(req.result as PhotoLut) : reject(new Error('LUT_NOT_FOUND'));
      req.onerror = () => reject(new Error('LUT_STORAGE_UNAVAILABLE'));
    });
  } finally {
    db.close();
  }
}
function decodeFile(file: File, bytes: ArrayBuffer): PhotoLut {
  if (/\.cube$/i.test(file.name))
    return parseCubeLut(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!/\.png$/i.test(file.name) || bytes.byteLength < 33) throw new Error('INVALID_LUT');
  const header = new DataView(bytes);
  if (
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(4) !== 0x0d0a1a0a ||
    header.getUint32(12) !== 0x49484452
  )
    throw new Error('INVALID_LUT');
  // Validate dimensions before asking the browser to allocate decoded image memory.
  pngLutLayout(header.getUint32(16), header.getUint32(20));
  if (header.getUint8(24) !== 8 || ![2, 6].includes(header.getUint8(25)))
    throw new Error('INVALID_LUT');
  // A LUT is numeric data: do not apply ICC/gamma conversion or premultiply its RGB by alpha.
  const image = decode(new Uint8Array(bytes), { checkCrc: true });
  return parsePngLut(image.data as Uint8Array, image.width, image.height, image.channels);
}
export async function importPhotoLut(file: File): Promise<PhotoLutEntry> {
  if (!file.size || file.size > 16 * 1024 * 1024) throw new Error('INVALID_LUT');
  const bytes = await file.arrayBuffer();
  const lut = decodeFile(file, bytes);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
  const entry: PhotoLutEntry = { id, ...photoLutFileName(file.name), size: lut.size };
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['entries', 'tables'], 'readwrite');
      const entries = transaction.objectStore('entries');
      const current = entries.get(id);
      current.onsuccess = () => {
        const previous = current.result as PhotoLutEntry | undefined;
        entries.put(entry.group ? entry : { ...previous, ...entry });
      };
      transaction.objectStore('tables').put(lut, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('LUT_STORAGE_UNAVAILABLE'));
      transaction.onabort = () => reject(new Error('LUT_STORAGE_UNAVAILABLE'));
    });
  } finally {
    db.close();
  }
  return entry;
}
