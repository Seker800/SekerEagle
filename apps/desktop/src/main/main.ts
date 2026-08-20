import { createReadStream } from 'node:fs';
import path from 'node:path';
import { desktopCacheRoot } from './cache-location';
import { Readable } from 'node:stream';
import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  protocol,
  session,
  utilityProcess,
  type UtilityProcess,
  type IpcMainInvokeEvent,
} from 'electron';
import { DEFAULT_DESKTOP_SERVER_URL, normalizeDesktopServerUrl } from './app-config';
import { AuthenticatedOwner } from './authenticated-owner';
import { MediaCacheController, type MediaResolution } from './media-cache-controller';
import { MediaRequestLimiter } from './media-request-limiter';
import { isAllowedAppNavigation } from './navigation-policy';
import { CacheRpcClient, type CacheRpcEndpoint, type CacheRpcMessage } from '../shared/cache-rpc';
import { DEFAULT_CACHE_LIMIT_BYTES } from '../utility/cache/cache-policy';
import { buildNamespaceId } from '../shared/media-identity';
import { DesktopSettingsStore } from './desktop-settings';

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
let cacheLimitBytes = DEFAULT_CACHE_LIMIT_BYTES;
let cacheRestartTimer: NodeJS.Timeout | null = null;
let cacheRestartHistory: number[] = [];
let shuttingDown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});

if (hasSingleInstanceLock)
  void app.whenReady().then(async () => {
    const settings = new DesktopSettingsStore(app.getPath('userData'));
    const initialSettings = await settings.load();
    cacheLimitBytes = initialSettings.cacheLimitBytes;
    await connectCacheProcess();

    const currentSession = session.defaultSession;
    const owner = new AuthenticatedOwner(() =>
      currentSession.fetch(new URL('/api/auth/me', serverUrl).toString(), {
        credentials: 'include',
        headers: { 'cache-control': 'no-store' },
      }),
    );
    currentSession.cookies.on('changed', () => owner.invalidate());
    powerMonitor.on('resume', () => {
      owner.invalidate();
      void cacheClient?.expireAuthorizations().catch(() => undefined);
    });
    lockDownSession(currentSession);
    registerCacheIpc(owner, settings);
    ipcMain.on('desktop:network-online', (event) => {
      try {
        assertTrustedIpcSender(event);
      } catch {
        return;
      }
      owner.invalidate();
      void cacheClient?.expireAuthorizations().catch(() => undefined);
    });

    const cache = cacheBackend();

    const controller = new MediaCacheController({
      serverUrl,
      cache,
      authenticatedOwner: () => owner.get(),
      fetchUpstream: (() => {
        const limiter = new MediaRequestLimiter(6, 64);
        return (mediaPath, options) =>
          limiter.fetch(() =>
            currentSession.fetch(new URL(mediaPath, serverUrl).toString(), {
              credentials: 'include',
              headers: {
                'cache-control': 'no-store',
                accept: 'image/avif,image/webp,image/*',
                'accept-encoding': 'identity',
                ...(options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
              },
            }),
          );
      })(),
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
  shuttingDown = true;
  if (cacheRestartTimer) clearTimeout(cacheRestartTimer);
  if (cacheClient) void cacheClient.close().catch(() => undefined);
  cacheProcess?.kill();
});

async function startCacheProcess(
  limitBytes = DEFAULT_CACHE_LIMIT_BYTES,
): Promise<{ child: UtilityProcess; client: CacheRpcClient }> {
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
  try {
    await client.initialize({
      cacheRoot: desktopCacheRoot({
        platform: process.platform,
        home: app.getPath('home'),
        appData: app.getPath('appData'),
        localAppData: process.env.LOCALAPPDATA,
        xdgCacheHome: process.env.XDG_CACHE_HOME,
      }),
      limitBytes,
    });
  } catch (error) {
    client.disconnect(error instanceof Error ? error : undefined);
    child.kill();
    throw error;
  }
  return { child, client };
}

async function connectCacheProcess(): Promise<void> {
  if (shuttingDown || cacheClient) return;
  try {
    const started = await startCacheProcess(cacheLimitBytes);
    if (shuttingDown) {
      started.client.disconnect();
      started.child.kill();
      return;
    }
    cacheClient = started.client;
    cacheProcess = started.child;
    started.child.once('exit', () => handleCacheProcessExit(started.child, started.client));
  } catch {
    scheduleCacheRestart();
  }
}

function handleCacheProcessExit(child: UtilityProcess, client: CacheRpcClient): void {
  client.disconnect();
  if (cacheProcess !== child) return;
  cacheProcess = null;
  cacheClient = null;
  scheduleCacheRestart();
}

function scheduleCacheRestart(): void {
  if (shuttingDown || cacheRestartTimer) return;
  const now = Date.now();
  cacheRestartHistory = cacheRestartHistory.filter((startedAt) => now - startedAt < 60_000);
  if (cacheRestartHistory.length >= 3) return;
  const delayMs = 250 * 2 ** cacheRestartHistory.length;
  cacheRestartHistory.push(now);
  cacheRestartTimer = setTimeout(() => {
    cacheRestartTimer = null;
    void connectCacheProcess();
  }, delayMs);
  cacheRestartTimer.unref();
}

function currentCache(): CacheRpcClient {
  if (!cacheClient) throw new Error('本地缓存暂时不可用。');
  return cacheClient;
}

function cacheBackend() {
  return {
    acquire: (...args: Parameters<CacheRpcClient['acquire']>) => currentCache().acquire(...args),
    release: (...args: Parameters<CacheRpcClient['release']>) => currentCache().release(...args),
    beginWrite: (...args: Parameters<CacheRpcClient['beginWrite']>) =>
      currentCache().beginWrite(...args),
    append: (...args: Parameters<CacheRpcClient['append']>) => currentCache().append(...args),
    commit: (...args: Parameters<CacheRpcClient['commit']>) => currentCache().commit(...args),
    abort: (...args: Parameters<CacheRpcClient['abort']>) => currentCache().abort(...args),
    renewAuthorization: (...args: Parameters<CacheRpcClient['renewAuthorization']>) =>
      currentCache().renewAuthorization(...args),
    invalidate: (...args: Parameters<CacheRpcClient['invalidate']>) =>
      currentCache().invalidate(...args),
  };
}

function registerCacheIpc(owner: AuthenticatedOwner, settings: DesktopSettingsStore): void {
  const namespace = async (event: IpcMainInvokeEvent): Promise<string> => {
    assertTrustedIpcSender(event);
    const identity = await owner.get();
    if (!identity) throw new Error('需要重新登录。');
    return buildNamespaceId(serverUrl, identity.ownerId, identity.deploymentId);
  };
  ipcMain.handle('desktop:cache-status', async (event) => {
    const namespaceId = await namespace(event);
    const [namespaceStats, globalStats, currentSettings] = await Promise.all([
      currentCache().getNamespaceStats(namespaceId),
      currentCache().getStats(),
      settings.load(),
    ]);
    return {
      ...namespaceStats,
      globalAllocatedBytes: globalStats.allocatedBytes,
      globalEntryCount: globalStats.entryCount,
      limitBytes: currentSettings.cacheLimitBytes,
    };
  });
  ipcMain.handle('desktop:set-cache-limit', async (event, limitGiB: unknown) => {
    assertTrustedIpcSender(event);
    if (typeof limitGiB !== 'number') throw new Error('缓存容量无效。');
    const updated = await settings.setCacheLimitGiB(limitGiB);
    cacheLimitBytes = updated.cacheLimitBytes;
    await currentCache().setLimitBytes(updated.cacheLimitBytes);
  });
  ipcMain.handle('desktop:clear-cache', async (event) =>
    currentCache().clearNamespace(await namespace(event)),
  );
  ipcMain.handle('desktop:invalidate-asset', async (event, assetId: unknown) => {
    if (typeof assetId !== 'string') throw new Error('资源标识无效。');
    return currentCache().invalidateAsset(await namespace(event), assetId);
  });
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (
    event.sender !== mainWindow?.webContents ||
    !senderUrl ||
    !isAllowedAppNavigation(serverUrl, senderUrl)
  ) {
    throw new Error('拒绝不受信任的桌面调用。');
  }
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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sekereagle-media:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
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
