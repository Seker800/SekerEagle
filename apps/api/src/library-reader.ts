import { setTimeout as delay } from 'node:timers/promises';
import { createLibraryReaderServer } from './eagle/eagle-memory-server';
import { createLibraryReadPool, LibraryReadStore } from './eagle/eagle-memory-store';
import {
  readResidentPhotoStatistics,
  residentStatisticsDaily,
} from './photos/photo-statistics-memory';
import type { LibraryMemoryIndex } from './eagle/eagle-memory-index';

/** Explicit standalone entry. Importing shared HTTP providers never starts it. */
export async function startLibraryReader(env = process.env) {
  if (!env.DATABASE_URL || !env.EAGLE_READER_TOKEN)
    throw new Error('Reader database and service identity are required');
  const url = new URL(env.DATABASE_URL);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '2');
  const db = createLibraryReadPool(url.toString());
  const store = new LibraryReadStore(db);
  const server = createLibraryReaderServer(
    store,
    env.EAGLE_READER_TOKEN,
    Number(env.EAGLE_READER_REQUEST_MAX_BYTES ?? 2097152),
    (index, includePrivate, query) => readResidentPhotoStatistics(db, index, includePrivate, query),
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(
      Number(env.EAGLE_READER_PORT ?? 3001),
      env.EAGLE_READER_HOST ?? '127.0.0.1',
      resolve,
    );
  });
  // Warm known scopes once, then inspect only the tiny enabled state table. No
  // periodic asset discovery, image access, inference or business queue execution.
  const scopes = (
    await db.query<{ ownerId: string; libraryMode: 'PHOTO' | 'MATERIAL' }>(
      'SELECT "ownerId","libraryMode" FROM "EagleLibraryReadState"',
    )
  ).rows;
  try {
    for (const scope of scopes) {
      if (stopping) break;
      prime(await store.synchronize(scope));
    }
    while (!stopping) {
      for (const scope of (
        await db.query<{ ownerId: string; libraryMode: 'PHOTO' | 'MATERIAL' }>(
          'SELECT "ownerId","libraryMode" FROM "EagleLibraryReadState" WHERE enabled',
        )
      ).rows) {
        if (stopping) break;
        try {
          prime(await store.synchronize(scope));
        } catch {
          console.error('Library reader synchronization failed; API retains SQL fallback');
        }
      }
      await delay(1000);
    }
  } finally {
    stop();
    await db.end();
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
function prime(index: LibraryMemoryIndex) {
  for (const date of ['libraryAddedAt', 'chronologicalAt'] as const)
    index.page({}, date, 'desc', 0, 0);
  if (index.libraryMode === 'PHOTO')
    for (const includePrivate of [false, true]) residentStatisticsDaily(index, includePrivate);
}
if (require.main === module)
  startLibraryReader().catch(() => {
    console.error('Library reader failed to start');
    process.exitCode = 1;
  });
