import { decode } from 'fast-png';
import { parseCubeLut, parsePngLut, pngLutLayout, type PhotoLut } from './photo-lut';
export interface PhotoLutEntry {
  id: string;
  name: string;
  size: number;
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
        resolve((req.result as PhotoLutEntry[]).sort((a, b) => a.name.localeCompare(b.name)));
      req.onerror = () => reject(new Error('LUT_STORAGE_UNAVAILABLE'));
    });
  } finally {
    db.close();
  }
}
export async function loadPhotoLut(id: string): Promise<PhotoLut> {
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
  const entry = { id, name: file.name.replace(/\.(cube|png)$/i, '').slice(0, 100), size: lut.size };
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['entries', 'tables'], 'readwrite');
      transaction.objectStore('entries').put(entry);
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
