import { imageWorkResponseLimit } from './image-work-budget';
import type { MediaOperation } from './compute-node-config';
import { freemem, totalmem, loadavg } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARTIFACT_CONTENT_TYPE, encodeArtifacts, receiveArtifacts } from './compute-artifacts';
import {
  renderPyramidWork,
  validatePyramidDescriptor,
  validatePyramidArtifacts,
  pyramidTileDimensions,
  type PyramidDescriptor,
} from './pyramid-work';
import {
  renderVideoWork,
  validateVideoWork,
  validateVideoManifest,
  validateVideoArtifacts,
  type VideoWork,
  type VideoManifest,
} from './video-work';
import {
  streamFetch,
  MEDIA_VIDEO_REQUEST_TIMEOUT_MS,
  type CameraVideoEncoder,
} from '@sekereagle/media-core';
import {
  processImageWork,
  validateImageWork,
  encodeImageWork,
  decodeImageWork,
  IMAGE_WORK_MAX_RESPONSE_BYTES,
  IMAGE_WORK_CONTENT_TYPE,
  type ImageWork,
} from './image-work';
import { inferPhotoFaces, validateFaceResult, FACE_MODEL_VERSION } from './face-inference';
import {
  CAMERA_MAX_IMAGE_BYTES,
  CAMERA_MAX_VIDEO_BYTES,
  CAMERA_MEDIA_FORMATS,
} from '@sekereagle/library-core';
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
    size += Buffer.byteLength(chunk);
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
export function createRemoteMediaServer(
  token: string,
  limit = 1,
  facesReady = false,
  videoEncoder?: CameraVideoEncoder,
  configuredOperations?: MediaOperation[],
) {
  if (!token || token.length < 8 || !Number.isInteger(limit) || limit < 1 || limit > 4)
    throw new Error('INVALID_MEDIA_AGENT_CONFIGURATION');
  const operations: MediaOperation[] = configuredOperations ?? [
    'image',
    ...(facesReady ? ['faces' as const] : []),
    ...(videoEncoder ? ['video' as const] : []),
  ];
  if (
    !operations.length ||
    new Set(operations).size !== operations.length ||
    operations.some((op) => !['image', 'pyramid', 'faces', 'video'].includes(op)) ||
    (operations.includes('faces') && !facesReady) ||
    (operations.includes('video') && !videoEncoder)
  )
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
        operations,
        artifactEncoding: 'SEA1',
        faceVersion: faces ? FACE_MODEL_VERSION : null,
        system: {
          freeMemoryBytes: freemem(),
          totalMemoryBytes: totalmem(),
          processRssBytes: process.memoryUsage().rss,
          loadAverage: loadavg()[0] ?? 0,
        },
        capacity: { limit, inFlight: active, available: Math.max(0, limit - active) },
      });
    if (
      req.method !== 'POST' ||
      !['/v1/media/image', '/v1/media/faces', '/v1/media/pyramid', '/v1/media/video'].includes(
        req.url ?? '',
      )
    )
      return send(404, { error: 'NOT_FOUND' });
    if (!operations.includes(req.url!.split('/').at(-1) as MediaOperation))
      return send(503, { error: 'OPERATION_UNAVAILABLE' });
    if (active >= limit) {
      res.setHeader('Retry-After', '1');
      return send(503, { error: 'MEDIA_BUSY' });
    }
    active++;
    const artifact = req.url === '/v1/media/pyramid' || req.url === '/v1/media/video';
    const timeout = setTimeout(
      () => req.destroy(new Error('MEDIA_BODY_TIMEOUT')),
      req.url === '/v1/media/video' ? 900000 : 120000,
    );
    timeout.unref();
    try {
      const isImage = req.url === '/v1/media/image' || artifact;
      const contentType = req.headers['content-type']?.split(';')[0];
      if (
        isImage
          ? contentType !== 'application/octet-stream'
          : !['image/jpeg', 'image/webp', 'image/png'].includes(contentType ?? '')
      )
        return send(415, { error: 'MEDIA_TYPE' });
      if (artifact) {
        const header = req.headers['x-artifact-work'];
        if (typeof header !== 'string' || header.length > 2048)
          return send(400, { error: 'INVALID_ARTIFACT_WORK' });
        const work: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
        const recipe = work as { mimeType?: unknown };
        const video = req.url === '/v1/media/video';
        if (video && !videoEncoder) return send(503, { error: 'VIDEO_UNAVAILABLE' });
        if (video) validateVideoWork(work);
        else if (
          !work ||
          Object.keys(work).length !== 1 ||
          typeof recipe.mimeType !== 'string' ||
          !CAMERA_MEDIA_FORMATS.some((f) => f.kind !== 'video' && f.mimeType === recipe.mimeType)
        )
          throw new Error('INVALID_IMAGE_WORK');
        const source = (async function* () {
          let size = 0;
          try {
            for await (const chunk of req) {
              size += Buffer.byteLength(chunk as Uint8Array);
              if (size > (video ? CAMERA_MAX_VIDEO_BYTES : CAMERA_MAX_IMAGE_BYTES))
                throw new Error('MEDIA_PAYLOAD_TOO_LARGE');
              yield chunk as Uint8Array;
            }
          } finally {
            clearTimeout(timeout);
          }
        })();
        const directory = await mkdtemp(join(tmpdir(), 'sekereagle-artifacts-'));
        try {
          let manifest: unknown, paths: { name: string; path: string }[];
          if (video) {
            const result = await renderVideoWork(
              source,
              validateVideoWork(work),
              directory,
              videoEncoder,
            );
            manifest = result.manifest;
            paths = result.files.map((name) => ({ name, path: join(directory, name) }));
          } else {
            const result = await renderPyramidWork(
              source,
              recipe.mimeType as string,
              'input',
              directory,
            );
            manifest = { sha256: result.sha256, descriptor: result.descriptor };
            paths = result.files.map((name) => ({ name, path: join(result.tileDirectory, name) }));
          }
          if (res.destroyed) return;
          const entries = await Promise.all(
            paths.map(async (file) => ({
              name: file.name,
              size: (await stat(file.path)).size,
              source: () => createReadStream(file.path),
            })),
          );
          res.writeHead(200, {
            'content-type': ARTIFACT_CONTENT_TYPE,
            'cache-control': 'no-store',
          });
          await pipeline(Readable.from(encodeArtifacts(manifest, entries)), res);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
        return;
      }
      const bytes = await body(req, isImage ? CAMERA_MAX_IMAGE_BYTES : 20 * 1024 * 1024);
      clearTimeout(timeout);
      if (isImage) {
        const header = req.headers['x-image-work'];
        if (typeof header !== 'string' || header.length > 2048)
          return send(400, { error: 'IMAGE_WORK' });
        const work = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as ImageWork;
        const result = await processImageWork(Readable.from([bytes]), validateImageWork(work));
        const output = encodeImageWork(result, work);
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
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      send(
        e instanceof Error &&
          ['MEDIA_PAYLOAD_TOO_LARGE', 'IMAGE_RESULT_TOO_LARGE'].includes(e.message)
          ? 413
          : isPermanentMediaValidationError(e)
            ? 422
            : e instanceof SyntaxError ||
                (e instanceof Error &&
                  ['INVALID_IMAGE_WORK', 'INVALID_VIDEO_WORK'].includes(e.message))
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
  server.requestTimeout = 900000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 32;
  return server;
}
export class RemoteMediaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}
  private async request<T>(
    path: string,
    input: AsyncIterable<Uint8Array>,
    headers: Record<string, string>,
    consume: (body: AsyncIterable<Uint8Array>) => Promise<T>,
    maximum = CAMERA_MAX_IMAGE_BYTES,
  ) {
    const hash = createHash('sha256');
    let size = 0;
    let sourceError: Error | undefined;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const chunk of input) {
            size += Buffer.byteLength(chunk);
            if (size > maximum) throw new Error('MEDIA_PAYLOAD_TOO_LARGE');
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
        response = await streamFetch(this.baseUrl.replace(/\/+$/, '') + path, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.token}`, ...headers },
          body: stream,
          signal: AbortSignal.timeout(
            path.endsWith('/video') ? MEDIA_VIDEO_REQUEST_TIMEOUT_MS : 600000,
          ),
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
      if (path.endsWith('/pyramid') || path.endsWith('/video'))
        if (response.headers.get('content-type') !== ARTIFACT_CONTENT_TYPE)
          throw new Error('ARTIFACT_MEDIA_TYPE');
      const value = await consume(response.body);
      if (sourceError) throw sourceError;
      return { value, sha256: hash.digest('hex') };
    } finally {
      stream.destroy();
    }
  }
  async image(source: AsyncIterable<Uint8Array>, work: ImageWork) {
    const result = await this.request(
      '/v1/media/image',
      source,
      {
        'content-type': 'application/octet-stream',
        'x-image-work': Buffer.from(JSON.stringify(work)).toString('base64url'),
      },
      (source) => body(source, imageWorkResponseLimit(work)),
    );
    const decoded = await decodeImageWork(result.value, work);
    if (decoded.sha256 !== result.sha256) throw new Error('MEDIA_SOURCE_HASH_MISMATCH');
    return decoded;
  }
  async faces(bytes: Buffer) {
    const result = await this.request(
      '/v1/media/faces',
      Readable.from([bytes]),
      {
        'content-type': 'image/jpeg',
      },
      (source) => body(source, 1024 * 1024),
    );
    return validateFaceResult(JSON.parse(result.value.toString('utf8')));
  }
  async pyramid(source: AsyncIterable<Uint8Array>, mimeType: string, directory: string) {
    let descriptor: PyramidDescriptor | undefined;
    let expectedHash = '';
    const response = await this.request(
      '/v1/media/pyramid',
      source,
      {
        'content-type': 'application/octet-stream',
        'x-artifact-work': Buffer.from(JSON.stringify({ mimeType })).toString('base64url'),
      },
      (stream) =>
        receiveArtifacts(
          stream,
          directory,
          (value) => {
            const manifest = value as { sha256?: unknown; descriptor?: unknown };
            if (
              !manifest ||
              typeof manifest.sha256 !== 'string' ||
              !/^[a-f0-9]{64}$/.test(manifest.sha256)
            )
              throw new Error('INVALID_PYRAMID_RESULT');
            expectedHash = manifest.sha256;
            descriptor = validatePyramidDescriptor(manifest.descriptor);
          },
          (name, size) => {
            if (size > 1024 * 1024) throw new Error('INVALID_PYRAMID_TILE');
            pyramidTileDimensions(descriptor!, name);
          },
        ),
    );
    if (response.sha256 !== expectedHash) throw new Error('MEDIA_SOURCE_HASH_MISMATCH');
    await validatePyramidArtifacts(
      descriptor!,
      response.value.files.map((name) => ({ name, path: join(directory, name) })),
    );
    return {
      descriptor: descriptor!,
      sha256: expectedHash,
      tileDirectory: directory,
      files: response.value.files,
    };
  }
  async video(source: AsyncIterable<Uint8Array>, work: VideoWork, directory: string) {
    validateVideoWork(work);
    let manifest: VideoManifest | undefined;
    const response = await this.request(
      '/v1/media/video',
      source,
      {
        'content-type': 'application/octet-stream',
        'x-artifact-work': Buffer.from(JSON.stringify(work)).toString('base64url'),
      },
      (stream) =>
        receiveArtifacts(
          stream,
          directory,
          (value) => {
            manifest = validateVideoManifest(value, work);
          },
          (name, size) => {
            if (
              !['poster.jpg', 'preview.mp4'].includes(name) ||
              (name === 'poster.jpg' && size > 4 * 1024 * 1024) ||
              (name === 'preview.mp4' && size >= 1024 ** 3)
            )
              throw new Error('INVALID_VIDEO_RESULT');
          },
        ),
      CAMERA_MAX_VIDEO_BYTES,
    );
    if (response.sha256 !== manifest!.sha256) throw new Error('MEDIA_SOURCE_HASH_MISMATCH');
    await validateVideoArtifacts(
      manifest!,
      response.value.files.map((name) => ({ name, path: join(directory, name) })),
    );
    return manifest!;
  }
}
