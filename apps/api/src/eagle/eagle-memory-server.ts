import type { memoryStatisticsSummary, memoryPhotoFacets } from './eagle-memory-protocol';
import { residentColorPage } from './eagle-memory-color';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { LibraryReadStore } from './eagle-memory-store';
import type { AssetSearchWhere } from './eagle-search-predicate';
import type { LibraryMemoryIndex } from './eagle-memory-index';
import type { ResidentSmartFolderOptions } from './eagle-memory-semantic';
import type { ImageSearchPosition } from './eagle-image-search.service';
import { semanticFolderIds } from './eagle-memory-semantic';
import type { MemorySearchContext } from './eagle-memory-predicate';
import {
  memorySemanticOptions,
  memoryStatisticsQuery,
  memoryColorOptions,
} from './eagle-memory-protocol';

const querySchema = z
  .object({
    scope: z
      .object({ ownerId: z.string().min(1), libraryMode: z.enum(['MATERIAL', 'PHOTO']) })
      .strict(),
    where: z.record(z.string(), z.unknown()),
    action: z.enum([
      'page',
      'count',
      'statistics',
      'peopleCounts',
      'smartFolderPage',
      'facets',
      'colorPage',
    ]),
    semantic: memorySemanticOptions.optional(),
    colorPage: memoryColorOptions.optional(),
    includePrivate: z.boolean().default(false),
    statistics: memoryStatisticsQuery.optional(),
    date: z.enum(['libraryAddedAt', 'chronologicalAt']).default('libraryAddedAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    take: z.number().int().nonnegative().safe().default(0),
    skip: z.number().int().nonnegative().safe().default(0),
  })
  .strict();

import { decodeMemoryQuery } from './eagle-memory-protocol';

async function body(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (!(chunk instanceof Uint8Array) && typeof chunk !== 'string')
      throw new TypeError('Invalid body chunk');
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > maxBytes) return null;
    chunks.push(data);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface LibraryReadHandlers {
  facets?: (
    index: LibraryMemoryIndex,
    includePrivate: boolean,
  ) => Promise<z.infer<typeof memoryPhotoFacets>>;
  semanticQuery?: <T>(
    index: LibraryMemoryIndex,
    folderIds: string[],
    read: (context: MemorySearchContext, view: LibraryMemoryIndex) => T,
    signal?: AbortSignal,
  ) => T | Promise<T>;
  smartFolderPage?: (
    index: LibraryMemoryIndex,
    options: ResidentSmartFolderOptions,
    signal?: AbortSignal,
  ) =>
    | { revision: string; positions: ImageSearchPosition[] }
    | Promise<{ revision: string; positions: ImageSearchPosition[] }>;
  statistics?: (
    index: LibraryMemoryIndex,
    includePrivate: boolean,
    query: z.infer<typeof memoryStatisticsQuery>,
  ) => Promise<z.infer<typeof memoryStatisticsSummary>>;
  peopleCounts?: (
    index: LibraryMemoryIndex,
    includePrivate: boolean,
  ) => Array<{ id: string; photos: number }>;
}
/** Internal service only; public owner/mode and authentication remain the API's responsibility. */
export function createLibraryReaderServer(
  store: Pick<LibraryReadStore, 'read'>,
  token: string,
  maxBytes = 2 * 1024 * 1024,
  handlers: LibraryReadHandlers = {},
) {
  if (!token) throw new Error('Library reader service identity is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Invalid reader body byte budget');
  const expected = Buffer.from(`Bearer ${token}`);
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const cancellation = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) cancellation.abort();
    });
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      send(401, { error: 'Unauthorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      send(200, { status: 'alive' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/query') {
      send(404, { error: 'Not found' });
      return;
    }
    try {
      const text = await body(request, maxBytes);
      if (text === null) {
        send(413, { error: 'Reader request exceeds byte budget' });
        return;
      }
      const parsed = querySchema.safeParse(decodeMemoryQuery(text));
      if (!parsed.success) {
        send(400, { error: 'Invalid reader query' });
        return;
      }
      const query = parsed.data;
      const index = await store.read(query.scope, cancellation.signal);
      cancellation.signal.throwIfAborted();
      const revision = index.revision;
      const where = query.where as AssetSearchWhere;
      if (query.action === 'colorPage') {
        if (!query.colorPage) {
          send(400, { error: 'Invalid color page' });
          return;
        }
        const options = { ...query.colorPage, where };
        const read = (context?: MemorySearchContext, view = index) => ({
          revision: view.revision,
          positions: residentColorPage(view, options, context),
        });
        const folders = semanticFolderIds(where);
        if (folders.length && !handlers.semanticQuery)
          throw new Error('Semantic capability unavailable');
        send(
          200,
          folders.length
            ? await handlers.semanticQuery!(index, folders, read, cancellation.signal)
            : read(),
        );
        return;
      }
      if (query.action === 'smartFolderPage') {
        if (!handlers.smartFolderPage || !query.semantic) {
          send(503, { error: 'Reader capability unavailable' });
          return;
        }
        send(
          200,
          await handlers.smartFolderPage(index, { ...query.semantic, where }, cancellation.signal),
        );
        return;
      }
      if (query.action === 'facets') {
        if (!handlers.facets || query.scope.libraryMode !== 'PHOTO') {
          send(503, { error: 'Reader capability unavailable' });
          return;
        }
        send(200, { revision, facets: await handlers.facets(index, query.includePrivate) });
        return;
      }
      if (query.action === 'statistics') {
        if (!handlers.statistics || !query.statistics || query.scope.libraryMode !== 'PHOTO') {
          send(503, { error: 'Reader capability unavailable' });
          return;
        }
        send(200, {
          revision,
          summary: await handlers.statistics(index, query.includePrivate, query.statistics),
        });
        return;
      }
      if (query.action === 'peopleCounts') {
        if (!handlers.peopleCounts || query.scope.libraryMode !== 'PHOTO') {
          send(503, { error: 'Reader capability unavailable' });
          return;
        }
        send(200, { revision, counts: handlers.peopleCounts(index, query.includePrivate) });
        return;
      }
      const read = (context?: MemorySearchContext, view = index) =>
        query.action === 'count'
          ? { revision: view.revision, count: view.count(where, context) }
          : {
              revision: view.revision,
              ids: view.page(where, query.date, query.direction, query.take, query.skip, context),
            };
      const folders = semanticFolderIds(where);
      if (folders.length && !handlers.semanticQuery)
        throw new Error('Semantic capability unavailable');
      send(
        200,
        folders.length
          ? await handlers.semanticQuery!(index, folders, read, cancellation.signal)
          : read(),
      );
    } catch (error) {
      if (!response.headersSent && !response.destroyed)
        send(error instanceof SyntaxError ? 400 : 503, {
          error: 'Reader unavailable or predicate unsupported',
        });
    }
  };
  return createServer({ requestTimeout: 10000, headersTimeout: 10000 }, (request, response) => {
    void handle(request, response);
  });
}
