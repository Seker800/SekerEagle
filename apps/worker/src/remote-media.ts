import { freemem, totalmem, loadavg } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  processImageWork,
  validateImageWork,
  encodeImageWork,
  decodeImageWork,
  IMAGE_WORK_MAX_RESPONSE_BYTES,
  IMAGE_WORK_CONTENT_TYPE,
  type ImageWork,
} from './image-work';
import { inferPhotoFaces, validateFaceResult, FACE_MODEL_VERSION } from './photo-faces';
import { CAMERA_MAX_IMAGE_BYTES } from '@sekereagle/library-core';
import {
  PermanentMediaValidationError,
  isPermanentMediaValidationError,
} from './media-validation-error';
export class RemoteMediaUnavailableError extends Error {
  constructor(readonly deferResource = true) {
    super('WAITING_REMOTE_MEDIA_CAPACITY');
  }
}
async function body(stream: AsyncIterable<Uint8Array>, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('MEDIA_PAYLOAD_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function authorized(header: string | undefined, token: string) {
  const a = Buffer.from(header ?? ''),
    b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createRemoteMediaServer(token: string, limit = 1, facesReady = false) {
  if (!token || token.length < 8 || !Number.isInteger(limit) || limit < 1 || limit > 4)
    throw new Error('INVALID_MEDIA_AGENT_CONFIGURATION');
  let active = 0;
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, value: unknown) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      }
    };
    if (!authorized(req.headers.authorization, token)) return send(401, { error: 'UNAUTHORIZED' });
    const faces = facesReady;
    if (req.url === '/healthz' && req.method === 'GET')
      return send(200, {
        status: 'ready',
        protocol: 'sekereagle-media-v1',
        imageEncoding: 'SEI1',
        operations: ['image', ...(faces ? ['faces'] : [])],
        faceVersion: faces ? FACE_MODEL_VERSION : null,
        system: {
          freeMemoryBytes: freemem(),
          totalMemoryBytes: totalmem(),
          processRssBytes: process.memoryUsage().rss,
          loadAverage: loadavg()[0] ?? 0,
        },
        capacity: { limit, inFlight: active, available: Math.max(0, limit - active) },
      });
    if (req.method !== 'POST' || !['/v1/media/image', '/v1/media/faces'].includes(req.url ?? ''))
      return send(404, { error: 'NOT_FOUND' });
    if (active >= limit) {
      res.setHeader('Retry-After', '1');
      return send(503, { error: 'MEDIA_BUSY' });
    }
    active++;
    const timeout = setTimeout(() => req.destroy(new Error('MEDIA_BODY_TIMEOUT')), 120000);
    timeout.unref();
    try {
      const isImage = req.url === '/v1/media/image';
      const contentType = req.headers['content-type']?.split(';')[0];
      if (
        isImage
          ? contentType !== 'application/octet-stream'
          : !['image/jpeg', 'image/webp', 'image/png'].includes(contentType ?? '')
      )
        return send(415, { error: 'MEDIA_TYPE' });
      const bytes = await body(req, isImage ? CAMERA_MAX_IMAGE_BYTES : 20 * 1024 * 1024);
      clearTimeout(timeout);
      if (isImage) {
        const header = req.headers['x-image-work'];
        if (typeof header !== 'string' || header.length > 2048)
          return send(400, { error: 'IMAGE_WORK' });
        const work = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as ImageWork;
        const result = await processImageWork(Readable.from([bytes]), validateImageWork(work));
        const output = encodeImageWork(result);
        if (output.length > IMAGE_WORK_MAX_RESPONSE_BYTES)
          throw new Error('MEDIA_PAYLOAD_TOO_LARGE');
        if (!res.destroyed) {
          res.writeHead(200, {
            'content-type': IMAGE_WORK_CONTENT_TYPE,
            'cache-control': 'no-store',
          });
          res.end(output);
        }
      } else {
        if (!faces) return send(422, { error: 'FACES_UNAVAILABLE' });
        send(200, { version: FACE_MODEL_VERSION, faces: await inferPhotoFaces(bytes) });
      }
    } catch (e) {
      send(
        e instanceof Error &&
          ['MEDIA_PAYLOAD_TOO_LARGE', 'IMAGE_RESULT_TOO_LARGE'].includes(e.message)
          ? 413
          : isPermanentMediaValidationError(e)
            ? 422
            : e instanceof SyntaxError || (e instanceof Error && e.message === 'INVALID_IMAGE_WORK')
              ? 400
              : 500,
        {
          error: 'MEDIA_COMPUTATION_FAILED',
        },
      );
    } finally {
      clearTimeout(timeout);
      active--;
    }
  }
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 32;
  return server;
}
export class RemoteMediaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}
  private async request(
    path: string,
    input: AsyncIterable<Uint8Array>,
    headers: Record<string, string>,
  ) {
    const hash = createHash('sha256');
    let size = 0;
    let sourceError: Error | undefined;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const chunk of input) {
            size += chunk.length;
            if (size > CAMERA_MAX_IMAGE_BYTES) throw new Error('MEDIA_PAYLOAD_TOO_LARGE');
            hash.update(chunk);
            yield chunk;
          }
        } catch (error) {
          sourceError = error instanceof Error ? error : new Error('MEDIA_SOURCE_READ_FAILED');
          throw error;
        }
      })(),
    );
    try {
      let response: Response;
      try {
        response = await fetch(this.baseUrl.replace(/\/+$/, '') + path, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.token}`, ...headers },
          body: stream,
          duplex: 'half',
          redirect: 'error',
          signal: AbortSignal.timeout(600000),
        });
      } catch {
        if (sourceError) throw sourceError;
        throw new RemoteMediaUnavailableError();
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([408, 429, 502, 503, 504].includes(response.status))
          throw new RemoteMediaUnavailableError(
            response.headers.get('x-compute-backpressure') !== 'node',
          );
        if ([413, 415, 422].includes(response.status))
          throw new PermanentMediaValidationError(
            'IMAGE_CONTENT_MISMATCH',
            'Remote media rejected invalid input.',
          );
        throw new Error('REMOTE_MEDIA_REQUEST_REJECTED');
      }
      if (!response.body) throw new Error('MEDIA_RESPONSE_EMPTY');
      const bytes = await body(
        response.body,
        path.endsWith('/faces') ? 1024 * 1024 : IMAGE_WORK_MAX_RESPONSE_BYTES,
      );
      return { bytes, sha256: hash.digest('hex') };
    } finally {
      stream.destroy();
    }
  }
  async image(source: AsyncIterable<Uint8Array>, work: ImageWork) {
    const result = await this.request('/v1/media/image', source, {
      'content-type': 'application/octet-stream',
      'x-image-work': Buffer.from(JSON.stringify(work)).toString('base64url'),
    });
    const decoded = await decodeImageWork(result.bytes, work);
    if (decoded.sha256 !== result.sha256) throw new Error('MEDIA_SOURCE_HASH_MISMATCH');
    return decoded;
  }
  async faces(bytes: Buffer) {
    const result = await this.request('/v1/media/faces', Readable.from([bytes]), {
      'content-type': 'image/jpeg',
    });
    return validateFaceResult(JSON.parse(result.bytes.toString('utf8')));
  }
}
