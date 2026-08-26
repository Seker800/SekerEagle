import { createReadStream } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { desktopCacheRoot } from './cache-location';
import { Readable } from 'node:stream';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  protocol,
  session,
  shell,
  utilityProcess,
  type UtilityProcess,
  type NativeImage,
  type IpcMainEvent,
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
import { DesktopConnectionSettingsStore } from './connection-settings';
import { connectionSettingsForServerUrl } from './connection-config';
import { connectionPageAsset, isConnectionPageUrl } from './connection-page-protocol';
import { DesktopConnectionResolver } from './connection-resolver';
import { DesktopConnectionService, type DesktopConnectionSnapshot } from './connection-service';
import { createDesktopConnectionProbe } from './connection-probe';
import { DesktopBrowserSession } from './browser-session';
import { availableBytesForPath, ensureCacheDirectory } from './cache-filesystem';
import { parseClipboardImageInput } from './clipboard-image';
import { copyPreparedFilesToDirectory } from './original-file-destination';
import {
  ORIGINAL_DRAG_EXPORT_TTL_MS,
  OriginalDragExporter,
  parseAssetDragInput,
  parsePreparedDragToken,
} from './original-drag-export';

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
  {
    scheme: 'sekereagle-app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: false,
      corsEnabled: false,
    },
  },
]);

const initialServerUrl = normalizeDesktopServerUrl(
  process.env.SEKEREAGLE_SERVER_URL ?? DEFAULT_DESKTOP_SERVER_URL,
);
const CONNECTION_PAGE_URL = 'sekereagle-app://connection/';
let serverUrl = initialServerUrl;
let mainWindow: BrowserWindow | null = null;
let cacheProcess: UtilityProcess | null = null;
let cacheClient: CacheRpcClient | null = null;
let cacheLimitBytes = DEFAULT_CACHE_LIMIT_BYTES;
let cacheRestartTimer: NodeJS.Timeout | null = null;
let cacheRestartHistory: number[] = [];
let shuttingDown = false;
let connectionService: DesktopConnectionService | null = null;
let mediaController: MediaCacheController | null = null;
let connectionRecovery: Promise<void> | null = null;
let browserSession: DesktopBrowserSession | null = null;
let clearPreparedOriginalDrags: () => void = () => undefined;

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
    const connectionSettings = new DesktopConnectionSettingsStore(
      app.getPath('userData'),
      connectionSettingsForServerUrl(initialServerUrl),
    );
    const initialSettings = await settings.load();
    cacheLimitBytes = initialSettings.cacheLimitBytes;
    await connectCacheProcess();

    const currentSession = session.defaultSession;
    browserSession = new DesktopBrowserSession(
      (url, init) => currentSession.fetch(url, init),
      () => serverUrl,
    );
    connectionService = new DesktopConnectionService(
      connectionSettings,
      new DesktopConnectionResolver(
        createDesktopConnectionProbe((url, init) => currentSession.fetch(url, init)),
      ),
    );
    const initialConnection = await connectionService.initialize();
    if (initialConnection.active) serverUrl = initialConnection.active.url;
    const owner = new AuthenticatedOwner(() =>
      currentBrowserSession().fetch('/api/auth/me', {
        credentials: 'include',
        headers: { 'cache-control': 'no-store' },
      }),
    );
    currentSession.cookies.on('changed', () => {
      owner.invalidate();
      clearPreparedOriginalDrags();
    });
    powerMonitor.on('resume', () => {
      owner.invalidate();
      clearPreparedOriginalDrags();
      void cacheClient?.expireAuthorizations().catch(() => undefined);
      void recoverConnection(owner);
    });
    lockDownSession(currentSession);
    registerCacheIpc(owner, settings);
    registerConnectionIpc(owner);
    registerClipboardIpc();
    const originalDragExporter = new OriginalDragExporter({
      rootPath: path.join(app.getPath('temp'), 'SekerEagle', 'OriginalDrag'),
      fetchOriginal: (assetId) =>
        currentBrowserSession().fetch(`/api/eagle/assets/${assetId}/original`, {
          credentials: 'include',
          headers: {
            accept: 'application/octet-stream',
            'accept-encoding': 'identity',
            'cache-control': 'no-store',
          },
        }),
    });
    await originalDragExporter.cleanupExpired().catch(() => undefined);
    clearPreparedOriginalDrags = registerOriginalDragIpc(owner, originalDragExporter);
    registerOriginalFileExportIpc(owner, originalDragExporter);
    ipcMain.on('desktop:network-online', (event) => {
      try {
        assertTrustedIpcSender(event);
      } catch {
        return;
      }
      owner.invalidate();
      void cacheClient?.expireAuthorizations().catch(() => undefined);
      void recoverConnection(owner);
    });

    mediaController = createMediaController(owner);
    protocol.handle('sekereagle-media', (request) => handleMediaRequest(request.url));
    protocol.handle('sekereagle-app', (request) => handleAppRequest(request.url));
    createWindow(initialConnection.active ? serverUrl : CONNECTION_PAGE_URL, owner);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const active = connectionService?.current()?.active;
        createWindow(active ? active.url : CONNECTION_PAGE_URL, owner);
      }
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
  clearPreparedOriginalDrags();
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
      cacheRoot: currentDesktopCacheRoot(),
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
  const namespace = async (
    event: IpcMainInvokeEvent,
    allowConnectionPage = false,
  ): Promise<string> => {
    if (allowConnectionPage) assertTrustedConnectionSender(event);
    else assertTrustedIpcSender(event);
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
  ipcMain.handle('desktop:get-cache-manager-status', async (event) => {
    assertConnectionPageSender(event);
    const cacheRoot = currentDesktopCacheRoot();
    const [globalStats, currentSettings, availableBytes, identity] = await Promise.all([
      currentCache().getStats(),
      settings.load(),
      availableBytesForPath(cacheRoot),
      owner.get(),
    ]);
    const currentAccountStats = identity
      ? await currentCache().getNamespaceStats(
          buildNamespaceId(serverUrl, identity.ownerId, identity.deploymentId),
        )
      : null;
    return {
      cachePath: cacheRoot,
      availableBytes,
      limitBytes: currentSettings.cacheLimitBytes,
      globalAllocatedBytes: globalStats.allocatedBytes,
      globalEntryCount: globalStats.entryCount,
      currentAccountStats,
    };
  });
  ipcMain.handle('desktop:set-cache-limit', async (event, limitGiB: unknown) => {
    assertTrustedConnectionSender(event);
    if (typeof limitGiB !== 'number') throw new Error('缓存容量无效。');
    const updated = await settings.setCacheLimitGiB(limitGiB);
    cacheLimitBytes = updated.cacheLimitBytes;
    await currentCache().setLimitBytes(updated.cacheLimitBytes);
  });
  ipcMain.handle('desktop:clear-cache', async (event) =>
    currentCache().clearNamespace(await namespace(event, true)),
  );
  ipcMain.handle('desktop:open-cache-folder', async (event) => {
    assertConnectionPageSender(event);
    const cacheRoot = currentDesktopCacheRoot();
    await ensureCacheDirectory(cacheRoot);
    const error = await shell.openPath(cacheRoot);
    if (error) throw new Error(`无法打开缓存目录：${error}`);
  });
  ipcMain.handle('desktop:invalidate-asset', async (event, assetId: unknown) => {
    if (typeof assetId !== 'string') throw new Error('资源标识无效。');
    return currentCache().invalidateAsset(await namespace(event), assetId);
  });
}

function currentDesktopCacheRoot(): string {
  return desktopCacheRoot({
    platform: process.platform,
    home: app.getPath('home'),
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA,
    xdgCacheHome: process.env.XDG_CACHE_HOME,
  });
}

function registerConnectionIpc(owner: AuthenticatedOwner): void {
  ipcMain.handle('desktop:get-connection-status', (event) => {
    assertTrustedConnectionSender(event);
    const snapshot = currentConnections();
    return {
      mode: snapshot.settings.mode,
      activeSlot: snapshot.active?.slot ?? null,
      activeUrl: snapshot.active?.url ?? null,
      latencyMs: snapshot.active?.latencyMs ?? null,
    };
  });
  ipcMain.handle('desktop:get-connection-manager-state', (event) => {
    assertConnectionPageSender(event);
    return currentConnections();
  });
  ipcMain.handle('desktop:test-connections', async (event, input: unknown) => {
    assertConnectionPageSender(event);
    return currentConnectionService().test(input);
  });
  ipcMain.handle('desktop:save-connections', async (event, input: unknown) => {
    assertConnectionPageSender(event);
    const snapshot = await currentConnectionService().save(input);
    if (snapshot.active) {
      setTimeout(() => void applyConnection(snapshot, owner), 0).unref();
    }
    return snapshot;
  });
  ipcMain.handle('desktop:reset-deployment-binding', async (event) => {
    assertConnectionPageSender(event);
    const snapshot = await currentConnectionService().resetDeploymentBinding();
    if (snapshot.active) {
      setTimeout(() => void applyConnection(snapshot, owner), 0).unref();
    }
    return snapshot;
  });
  ipcMain.handle('desktop:open-connection-manager', async (event) => {
    assertTrustedConnectionSender(event);
    await mainWindow?.loadURL(CONNECTION_PAGE_URL);
  });
  ipcMain.handle('desktop:cancel-connection-manager', async (event) => {
    assertConnectionPageSender(event);
    const active = currentConnections().active;
    if (active) await mainWindow?.loadURL(active.url);
  });
}

function registerClipboardIpc(): void {
  ipcMain.handle('desktop:write-clipboard-image', (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const image = nativeImage.createFromBuffer(Buffer.from(parseClipboardImageInput(input)));
    if (image.isEmpty()) throw new Error('剪贴板图片无法解码。');
    clipboard.writeImage(image);
  });
}

function registerOriginalDragIpc(
  owner: AuthenticatedOwner,
  exporter: OriginalDragExporter,
): () => void {
  const preparedDrags = new Map<
    string,
    {
      prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>>;
      serverUrl: string;
      icon: NativeImage;
      cleanupTimer: NodeJS.Timeout;
    }
  >();
  let dragInFlight = false;
  const removePreparedDrag = (token: string) => {
    const entry = preparedDrags.get(token);
    if (!entry) return;
    preparedDrags.delete(token);
    clearTimeout(entry.cleanupTimer);
    void exporter.remove(entry.prepared).catch(() => undefined);
  };
  const startNativeDrag = (
    event: IpcMainEvent | IpcMainInvokeEvent,
    prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>>,
    icon: NativeImage,
  ) => {
    const webContents = event.sender;
    webContents.startDrag({
      file: prepared.files[0],
      files: prepared.files,
      icon,
    });
  };

  ipcMain.handle('desktop:prepare-asset-drag', async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (dragInFlight) throw new Error('已有原文件正在准备，请稍候。');
    dragInFlight = true;
    const dragServerUrl = serverUrl;
    let prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>> | null = null;
    let preparedToken: string | null = null;
    try {
      const assetIds = parseAssetDragInput(input);
      const identity = await owner.get();
      if (!identity) throw new Error('需要重新登录。');
      const namespaceId = buildNamespaceId(dragServerUrl, identity.ownerId, identity.deploymentId);
      prepared = await exporter.prepare(namespaceId, assetIds);
      const icon = await app.getFileIcon(prepared.files[0], { size: 'normal' });
      const currentIdentity = await owner.get();
      if (
        dragServerUrl !== serverUrl ||
        !currentIdentity ||
        currentIdentity.ownerId !== identity.ownerId ||
        currentIdentity.deploymentId !== identity.deploymentId
      ) {
        throw new Error('账号或服务器已切换，请重新拖动素材。');
      }
      assertTrustedIpcSender(event);
      while (preparedDrags.size >= 8) removePreparedDrag(preparedDrags.keys().next().value!);
      const token = randomUUID();
      preparedToken = token;
      const cleanupTimer = setTimeout(() => removePreparedDrag(token), ORIGINAL_DRAG_EXPORT_TTL_MS);
      cleanupTimer.unref();
      preparedDrags.set(token, { prepared, serverUrl: dragServerUrl, icon, cleanupTimer });
      return { token };
    } catch (error) {
      if (preparedToken) removePreparedDrag(preparedToken);
      else if (prepared) await exporter.remove(prepared);
      throw error;
    } finally {
      dragInFlight = false;
    }
  });

  ipcMain.on('desktop:start-prepared-asset-drag', (event, input: unknown) => {
    try {
      assertTrustedIpcSender(event);
      const token = parsePreparedDragToken(input);
      const entry = preparedDrags.get(token);
      if (!entry || entry.serverUrl !== serverUrl) {
        if (entry) removePreparedDrag(token);
        return;
      }
      startNativeDrag(event, entry.prepared, entry.icon);
    } catch {
      return;
    }
  });

  return () => {
    const entries = [...preparedDrags.values()];
    preparedDrags.clear();
    for (const entry of entries) {
      clearTimeout(entry.cleanupTimer);
      void exporter.remove(entry.prepared).catch(() => undefined);
    }
  };
}

function registerOriginalFileExportIpc(
  owner: AuthenticatedOwner,
  exporter: OriginalDragExporter,
): void {
  let exportInFlight = false;
  ipcMain.handle('desktop:save-original-file', async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (exportInFlight) throw new Error('已有原文件正在导出，请稍候。');
    exportInFlight = true;
    const saveServerUrl = serverUrl;
    let prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>> | null = null;
    try {
      const [assetId] = parseAssetDragInput([input]);
      const identity = await owner.get();
      if (!identity) throw new Error('需要重新登录。');
      prepared = await exporter.prepare(
        buildNamespaceId(saveServerUrl, identity.ownerId, identity.deploymentId),
        [assetId],
      );
      await assertOriginalAccessStillCurrent(event, owner, saveServerUrl, identity);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('桌面窗口不可用。');
      const result = await dialog.showSaveDialog(window, {
        title: '另存原文件',
        buttonLabel: '保存',
        defaultPath: path.join(app.getPath('downloads'), path.basename(prepared.files[0])),
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await assertOriginalAccessStillCurrent(event, owner, saveServerUrl, identity);
      await copyFile(prepared.files[0], result.filePath);
      return { saved: true };
    } finally {
      if (prepared) await exporter.remove(prepared).catch(() => undefined);
      exportInFlight = false;
    }
  });

  ipcMain.handle('desktop:download-original-files', async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (exportInFlight) throw new Error('已有原文件正在导出，请稍候。');
    const assetIds = parseAssetDragInput(input);
    if (assetIds.length < 2) throw new Error('批量下载至少需要选择 2 项素材。');
    exportInFlight = true;
    const downloadServerUrl = serverUrl;
    let prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>> | null = null;
    try {
      const identity = await owner.get();
      if (!identity) throw new Error('需要重新登录。');
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('桌面窗口不可用。');
      const result = await dialog.showOpenDialog(window, {
        title: '选择批量下载文件夹',
        buttonLabel: '下载到此处',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length !== 1) return { downloaded: 0 };
      const destinationDirectory = result.filePaths[0]!;
      await assertOriginalAccessStillCurrent(event, owner, downloadServerUrl, identity);
      prepared = await exporter.prepare(
        buildNamespaceId(downloadServerUrl, identity.ownerId, identity.deploymentId),
        assetIds,
      );
      await assertOriginalAccessStillCurrent(event, owner, downloadServerUrl, identity);
      const copied = await copyPreparedFilesToDirectory(prepared.files, destinationDirectory);
      return { downloaded: copied.length };
    } finally {
      if (prepared) await exporter.remove(prepared).catch(() => undefined);
      exportInFlight = false;
    }
  });
}

async function assertOriginalAccessStillCurrent(
  event: IpcMainInvokeEvent,
  owner: AuthenticatedOwner,
  expectedServerUrl: string,
  identity: { ownerId: string; deploymentId: string },
): Promise<void> {
  const currentIdentity = await owner.get();
  if (
    expectedServerUrl !== serverUrl ||
    !currentIdentity ||
    currentIdentity.ownerId !== identity.ownerId ||
    currentIdentity.deploymentId !== identity.deploymentId
  ) {
    throw new Error('账号或服务器已切换，请重新导出素材。');
  }
  assertTrustedIpcSender(event);
}

function currentConnectionService(): DesktopConnectionService {
  if (!connectionService) throw new Error('连接管理尚未初始化。');
  return connectionService;
}

function currentBrowserSession(): DesktopBrowserSession {
  if (!browserSession) throw new Error('桌面登录会话尚未初始化。');
  return browserSession;
}

function currentConnections(): DesktopConnectionSnapshot {
  const snapshot = currentConnectionService().current();
  if (!snapshot) throw new Error('连接状态尚未初始化。');
  return snapshot;
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (
    event.sender !== mainWindow?.webContents ||
    !senderUrl ||
    !isAllowedAppNavigation(serverUrl, senderUrl)
  ) {
    throw new Error('拒绝不受信任的桌面调用。');
  }
}

function assertTrustedConnectionSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (
    event.sender !== mainWindow?.webContents ||
    !senderUrl ||
    (!isAllowedAppNavigation(serverUrl, senderUrl) && !isConnectionPageUrl(senderUrl))
  ) {
    throw new Error('拒绝不受信任的连接管理调用。');
  }
}

function assertConnectionPageSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (event.sender !== mainWindow?.webContents || !senderUrl || !isConnectionPageUrl(senderUrl)) {
    throw new Error('拒绝不受信任的连接配置调用。');
  }
}

function createWindow(initialUrl: string, owner: AuthenticatedOwner): void {
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
    if (!isAllowedAppNavigation(serverUrl, destination) && !isConnectionPageUrl(destination)) {
      event.preventDefault();
    }
  });
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, _description, validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && isAllowedAppNavigation(serverUrl, validatedUrl)) {
        void recoverConnection(owner);
      }
    },
  );
  void window.loadURL(initialUrl);
}

function lockDownSession(currentSession: Electron.Session): void {
  currentSession.setPermissionCheckHandler(() => false);
  currentSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  currentSession.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (!isAllowedAppNavigation(serverUrl, details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sekereagle-media:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          ],
        },
      });
    },
  );
}

async function handleMediaRequest(requestUrl: string): Promise<Response> {
  try {
    if (!mediaController) throw new Error('媒体控制器不可用。');
    const resolution = await mediaController.resolve(requestUrl);
    return resolutionToResponse(resolution);
  } catch {
    return new Response('媒体缓存暂时不可用。', { status: 502 });
  }
}

async function handleAppRequest(requestUrl: string): Promise<Response> {
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

function createMediaController(owner: AuthenticatedOwner): MediaCacheController {
  const limiter = new MediaRequestLimiter(6, 64);
  return new MediaCacheController({
    serverUrl,
    cache: cacheBackend(),
    authenticatedOwner: () => owner.get(),
    fetchUpstream: (mediaPath, options) =>
      limiter.fetch(() =>
        currentBrowserSession().fetch(mediaPath, {
          credentials: 'include',
          headers: {
            'cache-control': 'no-store',
            accept: 'image/avif,image/webp,image/*',
            'accept-encoding': 'identity',
            ...(options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
          },
        }),
      ),
  });
}

async function applyConnection(
  snapshot: DesktopConnectionSnapshot,
  owner: AuthenticatedOwner,
): Promise<void> {
  if (!snapshot.active) {
    await mainWindow?.loadURL(CONNECTION_PAGE_URL);
    return;
  }
  const changed = serverUrl !== snapshot.active.url;
  serverUrl = snapshot.active.url;
  if (changed) {
    owner.invalidate();
    clearPreparedOriginalDrags();
    void cacheClient?.expireAuthorizations().catch(() => undefined);
    mediaController = createMediaController(owner);
  }
  if (mainWindow?.webContents.getURL() !== serverUrl) await mainWindow?.loadURL(serverUrl);
}

async function recoverConnection(owner: AuthenticatedOwner): Promise<void> {
  if (connectionRecovery) return connectionRecovery;
  connectionRecovery = currentConnectionService()
    .retry()
    .then((snapshot) => applyConnection(snapshot, owner))
    .finally(() => {
      connectionRecovery = null;
    });
  return connectionRecovery;
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
