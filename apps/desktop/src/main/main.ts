import { app, BrowserWindow, dialog, ipcMain, powerMonitor, protocol, session } from 'electron';
import path from 'node:path';
import { DEFAULT_DESKTOP_SERVER_URL, normalizeDesktopServerUrl } from './app-config';
import { AuthenticatedOwner } from './authenticated-owner';
import { DesktopBrowserSession } from './browser-session';
import {
  connectCacheProcess,
  expireCacheAuthorizations,
  setCacheLimitBytes,
  setPortableDataRoot,
  shutdownCache,
} from './cache-process';
import { connectionSettingsForServerUrl } from './connection-config';
import { recoverConnection } from './connection-lifecycle';
import { connectionPageUrl, normalizeDesktopLocale } from './desktop-locale';
import { DesktopContext } from './desktop-context';
import { DesktopConnectionResolver } from './connection-resolver';
import { DesktopConnectionService } from './connection-service';
import { createDesktopConnectionProbe } from './connection-probe';
import { DesktopConnectionSettingsStore } from './connection-settings';
import { DesktopSettingsStore } from './desktop-settings';
import { registerCacheIpc } from './ipc/cache-ipc';
import { registerClipboardIpc } from './ipc/clipboard-ipc';
import { registerConnectionIpc } from './ipc/connection-ipc';
import { registerOriginalDragIpc } from './ipc/original-drag-ipc';
import { registerOriginalFileExportIpc } from './ipc/original-file-export-ipc';
import { registerNetworkOnlineIpc, registerSessionIpc } from './ipc/session-ipc';
import { registerLibraryReadIpc } from './library-read-ipc';
import { createMediaController, handleAppRequest, handleMediaRequest } from './media-protocol';
import { OriginalDragExporter } from './original-drag-export';
import {
  portableProfileRoot,
  preparePortableDataRoot,
  resolvePortableDataRoot,
} from './portable-data';
import { createWindow, lockDownSession } from './window';
import {
  DEFAULT_CACHE_LIMIT_BYTES,
  PORTABLE_DEFAULT_CACHE_LIMIT_BYTES,
} from '../utility/cache/cache-policy';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sekereagle-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
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

let portableDataRoot: string | null = null;
let portableStartupFailed = false;
try {
  portableDataRoot = resolvePortableDataRoot(process.platform, process.env);
  if (portableDataRoot) {
    preparePortableDataRoot(portableDataRoot);
    app.setPath('userData', portableProfileRoot(portableDataRoot));
  }
  setPortableDataRoot(portableDataRoot);
} catch (error) {
  portableStartupFailed = true;
  dialog.showErrorBox(
    'SekerEagle 便携版无法启动',
    `无法在程序旁边创建或写入 SekerEagleData。请把程序移动到可写目录后重试。\n\n${error instanceof Error ? error.message : '未知错误'}`,
  );
  app.exit(1);
}

const initialServerUrl = normalizeDesktopServerUrl(
  process.env.SEKEREAGLE_SERVER_URL ?? DEFAULT_DESKTOP_SERVER_URL,
);
const ctx = new DesktopContext(initialServerUrl);

const hasSingleInstanceLock = !portableStartupFailed && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (ctx.mainWindow?.isMinimized()) ctx.mainWindow.restore();
  ctx.mainWindow?.show();
  ctx.mainWindow?.focus();
});

if (hasSingleInstanceLock)
  void app.whenReady().then(async () => {
    ctx.desktopLocale = normalizeDesktopLocale(app.getLocale());
    const settings = new DesktopSettingsStore(
      app.getPath('userData'),
      portableDataRoot ? PORTABLE_DEFAULT_CACHE_LIMIT_BYTES : DEFAULT_CACHE_LIMIT_BYTES,
    );
    const connectionSettings = new DesktopConnectionSettingsStore(
      app.getPath('userData'),
      connectionSettingsForServerUrl(initialServerUrl),
    );
    const initialSettings = await settings.load();
    setCacheLimitBytes(initialSettings.cacheLimitBytes);
    await connectCacheProcess();

    const currentSession = session.defaultSession;
    ctx.browserSession = new DesktopBrowserSession(
      (url, init) => currentSession.fetch(url, init),
      () => ctx.serverUrl,
    );
    ctx.connectionService = new DesktopConnectionService(
      connectionSettings,
      new DesktopConnectionResolver(
        createDesktopConnectionProbe((url, init) => currentSession.fetch(url, init)),
      ),
    );
    const initialConnection = await ctx.connectionService.initialize();
    if (initialConnection.active) ctx.serverUrl = initialConnection.active.url;
    const owner = new AuthenticatedOwner(() =>
      ctx.currentBrowserSession().fetch('/api/auth/me', {
        credentials: 'include',
        headers: { 'cache-control': 'no-store' },
      }),
    );
    currentSession.cookies.on('changed', () => {
      ctx.librarySnapshot?.reset();
      owner.invalidate();
      ctx.clearPreparedOriginalDrags();
    });
    powerMonitor.on('resume', () => {
      ctx.librarySnapshot?.reset();
      owner.invalidate();
      ctx.clearPreparedOriginalDrags();
      void expireCacheAuthorizations();
      void recoverConnection(ctx, owner);
    });
    lockDownSession(ctx, currentSession);
    registerSessionIpc(ctx);
    registerLibraryReadIpc({
      ipcMain,
      assertTrustedIpcSender: (event) => ctx.assertTrustedIpcSender(event),
      snapshot: () => ctx.librarySnapshot,
    });
    registerCacheIpc(ctx, owner, settings);
    registerConnectionIpc(ctx, owner);
    registerClipboardIpc(ctx);
    const originalDragExporter = new OriginalDragExporter({
      rootPath: path.join(app.getPath('temp'), 'SekerEagle', 'OriginalDrag'),
      fetchOriginal: (assetId, signal, libraryMode) =>
        ctx
          .currentBrowserSession()
          .fetch(
            `/api/${libraryMode === 'PHOTO' ? 'photos' : 'eagle'}/assets/${assetId}/original`,
            {
              credentials: 'include',
              signal,
              headers: {
                accept: 'application/octet-stream',
                'accept-encoding': 'identity',
                'cache-control': 'no-store',
              },
            },
          ),
    });
    await originalDragExporter.cleanupExpired().catch(() => undefined);
    ctx.clearPreparedOriginalDrags = registerOriginalDragIpc(ctx, owner, originalDragExporter);
    registerOriginalFileExportIpc(ctx, owner, originalDragExporter);
    registerNetworkOnlineIpc(ctx, owner);

    createMediaController(ctx, owner);
    protocol.handle('sekereagle-media', (request) =>
      handleMediaRequest(ctx, request.url, request.signal, request.headers.get('origin')),
    );
    protocol.handle('sekereagle-app', (request) => handleAppRequest(request.url));
    createWindow(
      ctx,
      initialConnection.active ? ctx.serverUrl : connectionPageUrl(ctx.desktopLocale),
      owner,
    );

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const active = ctx.connectionService?.current()?.active;
        createWindow(ctx, active ? active.url : connectionPageUrl(ctx.desktopLocale), owner);
      }
    });
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ctx.shuttingDown = true;
  shutdownCache();
  ctx.clearPreparedOriginalDrags();
});
