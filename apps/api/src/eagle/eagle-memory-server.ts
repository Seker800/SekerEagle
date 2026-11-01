import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { LibraryReadStore } from './eagle-memory-store';
import type { AssetSearchWhere } from './eagle-search-predicate';

const querySchema = z
  .object({
    scope: z
      .object({ ownerId: z.string().min(1), libraryMode: z.enum(['MATERIAL', 'PHOTO']) })
      .strict(),
    where: z.record(z.string(), z.unknown()),
    action: z.enum(['page', 'count']),
    date: z.enum(['libraryAddedAt', 'chronologicalAt']).default('libraryAddedAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    take: z.number().int().nonnegative().safe().default(0),
    skip: z.number().int().nonnegative().safe().default(0),
  })
  .strict();

export const encodeMemoryQuery = (value: unknown) =>
  JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? { $bigint: String(item) } : item));
export const decodeMemoryQuery = (text: string): unknown =>
  JSON.parse(text, (_, item) =>
    item &&
    typeof item === 'object' &&
    Object.keys(item).length === 1 &&
    typeof item.$bigint === 'string'
      ? BigInt(item.$bigint)
      : item,
  );

async function body(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > maxBytes) return null;
    chunks.push(data);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Internal service only; public owner/mode and authentication remain the API's responsibility. */
export function createLibraryReaderServer(
  store: Pick<LibraryReadStore, 'synchronize'>,
  token: string,
  maxBytes = 2 * 1024 * 1024,
) {
  if (!token) throw new Error('Library reader service identity is required');
  const expected = Buffer.from(`Bearer ${token}`);
  return createServer(
    { requestTimeout: 10000, headersTimeout: 10000 },
    async (request, response) => {
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
        const index = await store.synchronize(query.scope);
        const where = query.where as AssetSearchWhere;
        send(
          200,
          query.action === 'count'
            ? { revision: index.revision, count: index.count(where) }
            : {
                revision: index.revision,
                ids: index.page(where, query.date, query.direction, query.take, query.skip),
              },
        );
      } catch (error) {
        if (!response.headersSent)
          send(error instanceof SyntaxError ? 400 : 503, {
            error: 'Reader unavailable or predicate unsupported',
          });
      }
    },
  );
}
