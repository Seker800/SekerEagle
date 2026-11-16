import { photoStatisticsFactFieldsSql } from './photos/photo-statistics-query';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { Client } from 'pg';
import { createLibraryReaderServer } from './eagle/reader-server';
import { createLibraryReadPool, LibraryReadStore } from './eagle/reader-store';
import {
  readResidentPhotoStatistics,
  residentStatisticsDaily,
} from './photos/photo-statistics-memory';
import type { LibraryMemoryIndex } from './eagle/reader-index';
import {
  readResidentSmartFolderPage,
  withResidentSemanticGraph,
} from './eagle/reader-semantic-store';
import { readResidentPhotoFacets, residentPhotoFacets } from './photos/photo-facets-memory';
import { residentPersonCounts } from './photos/photo-people-memory';

/** Explicit standalone entry. Importing shared HTTP providers never starts it. */
export async function startLibraryReader(env = process.env) {
  if (!env.DATABASE_URL || !env.EAGLE_READER_TOKEN)
    throw new Error('Reader database and service identity are required');
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT ?? 'http://minio:9000',
    s3Bucket: env.S3_BUCKET ?? 'sekereagle-reader-unused',
  });
  const url = new URL(env.DATABASE_URL);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '2');
  const db = createLibraryReadPool(url.toString());
  const store = new LibraryReadStore(db, photoStatisticsFactFieldsSql());
  const server = createLibraryReaderServer(
    store,
    env.EAGLE_READER_TOKEN,
    Number(env.EAGLE_READER_REQUEST_MAX_BYTES ?? 2097152),
    {
      statistics: (index, includePrivate, query) =>
        readResidentPhotoStatistics(db, index, includePrivate, query),
      peopleCounts: residentPersonCounts,
      facets: (index, privateVisible) => readResidentPhotoFacets(db, index, privateVisible),
      semanticQuery: (index, ids, read, signal) =>
        withResidentSemanticGraph(
          index,
          ids,
          (graph, view) => read(graph.context, view),
          undefined,
          signal,
        ),
      smartFolderPage: (index, options, signal) =>
        readResidentSmartFolderPage(index, options, undefined, signal),
    },
  );
  let stopping = false;
  let listener: Client | undefined;
  let wake: (() => void) | undefined;
  let pendingWake = false;
  const stop = () => {
    stopping = true;
    wake?.();
    server.close();
    server.closeAllConnections();
  };
  const listenerUrl = new URL(url.toString());
  listenerUrl.searchParams.delete('connection_limit');
  const connectListener = async () => {
    const client = new Client({ connectionString: listenerUrl.toString() });
    client.on('error', () => {
      if (listener === client) listener = undefined;
      void client.end().catch(() => undefined);
    });
    client.on('notification', () => {
      pendingWake = true;
      wake?.();
    });
    await client.connect();
    await client.query('LISTEN "eagle_library_read"');
    listener = client;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
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
    for (const scope of scopes) {
      if (stopping) break;
      prime(await store.synchronize(scope));
    }
    while (!stopping) {
      if (!listener) {
        try {
          await connectListener();
        } catch {
          console.error('Library reader notification listener unavailable; polling retained');
        }
      }
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
      if (stopping) break;
      await new Promise<void>((resolve) => {
        if (pendingWake) {
          pendingWake = false;
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, 30_000);
        timer.unref();
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          pendingWake = false;
          resolve();
        };
      });
    }
  } finally {
    stop();
    if (listener) await listener.end().catch(() => undefined);
    await db.end();
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
function prime(index: LibraryMemoryIndex) {
  for (const date of ['libraryAddedAt', 'chronologicalAt'] as const)
    index.page({}, date, 'desc', 0, 0);
  if (index.libraryMode === 'PHOTO')
    for (const includePrivate of [false, true]) {
      residentStatisticsDaily(index, includePrivate);
      residentPersonCounts(index, includePrivate);
      residentPhotoFacets(index, includePrivate);
    }
}
if (require.main === module)
  startLibraryReader().catch(() => {
    console.error('Library reader failed to start');
    process.exitCode = 1;
  });
