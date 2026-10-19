import type { SavedPhoto } from './photo-editor-save';

export interface LocalPhoto extends SavedPhoto {
  blob: Blob;
  createdAt: number;
}
// Development workbench only. Production uses the authenticated upload API.
async function openAlbum(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sekereagle-photo-editor-lab-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('LOCAL_ALBUM_UNAVAILABLE'));
  });
}
export async function saveLocalPhoto(file: File): Promise<SavedPhoto> {
  const db = await openAlbum();
  try {
    const photo: LocalPhoto = {
      id: crypto.randomUUID(),
      name: file.name,
      blob: file,
      createdAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('photos', 'readwrite');
      transaction.objectStore('photos').add(photo);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('LOCAL_ALBUM_SAVE_FAILED'));
      transaction.onabort = () => reject(new Error('LOCAL_ALBUM_SAVE_FAILED'));
    });
    return { id: photo.id, name: photo.name };
  } finally {
    db.close();
  }
}
export async function listLocalPhotos(): Promise<LocalPhoto[]> {
  const db = await openAlbum();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('photos').objectStore('photos').getAll();
      request.onsuccess = () =>
        resolve((request.result as LocalPhoto[]).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(new Error('LOCAL_ALBUM_READ_FAILED'));
    });
  } finally {
    db.close();
  }
}
