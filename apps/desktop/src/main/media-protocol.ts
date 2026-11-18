import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { AuthenticatedOwner } from './authenticated-owner';
import { connectionPageAsset } from './connection-page-protocol';
import type { DesktopContext } from './desktop-context';
import { MediaCacheController, type MediaResolution } from './media-cache-controller';
import { MediaRequestLimiter } from './media-request-limiter';
import { MediaSnapshotAuthorization } from './media-snapshot-authorization';
import { isAllowedMediaOrigin, mediaCorsHeaders } from './navigation-policy';
import { cacheBackend, releaseCacheLease } from './cache-process';

export function createMediaController(
  ctx: DesktopContext,
  owner: AuthenticatedOwner,
): MediaCacheController {
  ctx.librarySnapshot?.reset();
  const snapshot = new MediaSnapshotAuthorization({
    fetch: (path, init) => ctx.currentBrowserSession().fetch(path, init),
    authenticatedOwner: () => owner.get(),
    maxEntries: Number(process.env.SEKEREAGLE_DESKTOP_SNAPSHOT_ENTRIES ?? 12_000),
  });
  ctx.librarySnapshot = snapshot;
  const limiter = new MediaRequestLimiter(12, 128);
  return new MediaCacheController({
    serverUrl: ctx.serverUrl,
    cache: cacheBackend(),
    authenticatedOwner: () => owner.get(),
    canReadLocal: (media, identity, file) => snapshot.allows(media, identity, file),
    deniesLocal: (media, identity, file) => snapshot.denies(media, identity, file),
    onMediaRevoked: (event) => {
      ctx.librarySnapshot?.invalidateAsset(event.assetId);
      if (ctx.shuttingDown || !ctx.mainWindow || ctx.mainWindow.isDestroyed()) return;
      ctx.mainWindow.webContents.send('desktop:media-revoked', event);
    },
    fetchUpstream: (mediaPath, options) =>
      limiter.fetch(
        (signal) =>
          ctx.currentBrowserSession().fetch(mediaPath, {
            signal,
            credentials: 'include',
            headers: {
              'cache-control': 'no-store',
              accept: 'image/avif,image/webp,image/*',
              'accept-encoding': 'identity',
              ...(options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
            },
          }),
        options.signal,
      ),
  });
}

export async function handleMediaRequest(
  ctx: DesktopContext,
  requestUrl: string,
  signal: AbortSignal,
  origin: string | null,
): Promise<Response> {
  const requestServer = ctx.serverUrl;
  if (!isAllowedMediaOrigin(requestServer, origin)) return new Response(null, { status: 403 });
  const respond = (response: Response) => {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(mediaCorsHeaders(requestServer)))
      headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
  try {
    if (!ctx.mediaController) throw new Error('媒体控制器不可用。');
    const resolution = await ctx.mediaController.resolve(requestUrl, signal);
    return respond(resolutionToResponse(resolution));
  } catch {
    if (signal.aborted) return respond(new Response(null, { status: 499 }));
    return respond(new Response('媒体缓存暂时不可用。', { status: 502 }));
  }
}

export async function handleAppRequest(requestUrl: string): Promise<Response> {
  const asset = connectionPageAsset(requestUrl);
  if (!asset) return new Response('Not found', { status: 404 });
  try {
    return new Response(await readFile(path.join(__dirname, 'connection-page', asset.file)), {
      status: 200,
      headers: {
        'content-type': asset.type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('Connection page unavailable', { status: 500 });
  }
}

function resolutionToResponse(resolution: MediaResolution): Response {
  if (resolution.source === 'upstream') return resolution.response;
  if (resolution.source === 'error') {
    return new Response(resolution.message, { status: resolution.status });
  }

  const stream = createReadStream(resolution.filePath);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseCacheLease(resolution.leaseId);
  };
  stream.once('close', release);
  stream.once('error', release);
  stream.once('end', release);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'content-type': resolution.contentType,
      'content-length': String(resolution.logicalBytes),
      'cache-control': 'private, no-store',
      'x-sekereagle-cache-result': resolution.cacheResult,
      ...(resolution.etag ? { etag: resolution.etag } : {}),
      ...(resolution.lastModified ? { 'last-modified': resolution.lastModified } : {}),
    },
  });
}
