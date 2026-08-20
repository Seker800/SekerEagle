import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  app,
  BrowserWindow,
  powerMonitor,
  protocol,
  session,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { DEFAULT_DESKTOP_SERVER_URL, normalizeDesktopServerUrl } from './app-config';
import { AuthenticatedOwner } from './authenticated-owner';
import { MediaCacheController, type MediaResolution } from './media-cache-controller';
import { isAllowedAppNavigation } from './navigation-policy';
import { CacheRpcClient, type CacheRpcEndpoint, type CacheRpcMessage } from '../shared/cache-rpc';
import { DEFAULT_CACHE_LIMIT_BYTES } from '../utility/cache/cache-policy';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sekereagle-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: false,
    },
  },
]);

const serverUrl = normalizeDesktopServerUrl(
  process.env.SEKEREAGLE_SERVER_URL ?? DEFAULT_DESKTOP_SERVER_URL,
);
let mainWindow: BrowserWindow | null = null;
let cacheProcess: UtilityProcess | null = null;
let cacheClient: CacheRpcClient | null = null;

void app.whenReady().then(async () => {
  const cache = await startCacheProcess();
  cacheClient = cache.client;
  cacheProcess = cache.child;

  const currentSession = session.defaultSession;
  const owner = new AuthenticatedOwner(() =>
    currentSession.fetch(new URL('/api/auth/me', serverUrl).toString(), {
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    }),
  );
  currentSession.cookies.on('changed', () => owner.invalidate());
  powerMonitor.on('resume', () => owner.invalidate());
  lockDownSession(currentSession);

  const controller = new MediaCacheController({
    serverUrl,
    cache: cache.client,
    authenticatedOwner: () => owner.get(),
    fetchUpstream: (mediaPath, options) =>
      currentSession.fetch(new URL(mediaPath, serverUrl).toString(), {
        credentials: 'include',
        headers: {
          'cache-control': 'no-store',
          accept: 'image/avif,image/webp,image/*',
          'accept-encoding': 'identity',
          ...(options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
        },
      }),
  });
  protocol.handle('sekereagle-media', (request) => handleMediaRequest(controller, request.url));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (cacheClient) void cacheClient.close().catch(() => undefined);
  cacheProcess?.kill();
});

async function startCacheProcess(): Promise<{ child: UtilityProcess; client: CacheRpcClient }> {
  const child = utilityProcess.fork(path.join(__dirname, 'utility.cjs'), [], {
    serviceName: 'SekerEagle Media Cache',
  });
  const endpoint: CacheRpcEndpoint = {
    postMessage(message) {
      child.postMessage(message);
    },
    subscribe(listener) {
      const onMessage = (message: unknown) => listener(message as CacheRpcMessage);
      child.on('message', onMessage);
      return () => child.off('message', onMessage);
    },
  };
  const client = new CacheRpcClient(endpoint);
  await client.initialize({
    cacheRoot: path.join(app.getPath('sessionData'), 'MediaCache', 'v1'),
    limitBytes: DEFAULT_CACHE_LIMIT_BYTES,
  });
  return { child, client };
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'SekerEagle',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, destination) => {
    if (!isAllowedAppNavigation(serverUrl, destination)) event.preventDefault();
  });
  void window.loadURL(serverUrl);
}

function lockDownSession(currentSession: Electron.Session): void {
  currentSession.setPermissionCheckHandler(() => false);
  currentSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  currentSession.webRequest.onHeadersReceived({ urls: [`${serverUrl}/*`] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sekereagle-media:; media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
        ],
      },
    });
  });
}

async function handleMediaRequest(
  controller: MediaCacheController,
  requestUrl: string,
): Promise<Response> {
  try {
    const resolution = await controller.resolve(requestUrl);
    return resolutionToResponse(resolution);
  } catch {
    return new Response('媒体缓存暂时不可用。', { status: 502 });
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
    if (cacheClient) void cacheClient.release(resolution.leaseId).catch(() => undefined);
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
      ...(resolution.etag ? { etag: resolution.etag } : {}),
      ...(resolution.lastModified ? { 'last-modified': resolution.lastModified } : {}),
    },
  });
}
