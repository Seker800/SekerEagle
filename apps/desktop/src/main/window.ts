import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import type { AuthenticatedOwner } from './authenticated-owner';
import { recoverConnection } from './connection-lifecycle';
import type { DesktopContext } from './desktop-context';
import { isConnectionPageUrl } from './connection-page-protocol';
import { desktopContentSecurityPolicy, isAllowedAppNavigation } from './navigation-policy';

function logRendererFailure(kind: string, details: unknown): void {
  try {
    const directory = app.getPath('userData');
    mkdirSync(directory, { recursive: true });
    appendFileSync(
      path.join(directory, 'renderer-failures.log'),
      `${new Date().toISOString()} ${kind} ${JSON.stringify(details)}\n`,
    );
  } catch {
    // Crash reporting must never prevent recovery.
  }
}

export function createWindow(
  ctx: DesktopContext,
  initialUrl: string,
  owner: AuthenticatedOwner,
): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'SekerEagle',
    // Native frame reserves client space for fixed viewers, editors and dialogs.
    // A CSS margin cannot move viewport-positioned overlays below a title bar.
    ...(process.platform === 'win32' ? { autoHideMenuBar: true } : {}),
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
  ctx.mainWindow = window;
  if (process.platform === 'win32') {
    window.removeMenu();
  }
  let recoveryDialogOpen = false;
  window.webContents.on('render-process-gone', (_event, details) => {
    logRendererFailure('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      url: window.webContents.getURL(),
    });
    if (ctx.shuttingDown || details.reason === 'clean-exit' || recoveryDialogOpen) return;
    recoveryDialogOpen = true;
    setTimeout(() => {
      recoveryDialogOpen = false;
      if (window.isDestroyed() || ctx.shuttingDown) return;
      const choice = dialog.showMessageBoxSync(window, {
        type: 'error',
        title: '页面已停止运行',
        message: '地图或页面渲染进程意外退出，客户端已记录诊断信息。',
        detail:
          '可以重新加载页面继续使用；如再次发生，请把用户数据目录下的 renderer-failures.log 提供给维护者。',
        buttons: ['重新加载', '退出'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice === 0) window.webContents.reload();
      else app.quit();
    }, 0);
  });
  window.on('unresponsive', () => {
    logRendererFailure('unresponsive', { url: window.webContents.getURL() });
    if (ctx.shuttingDown || recoveryDialogOpen) return;
    recoveryDialogOpen = true;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: '页面无响应',
      message: '页面长时间没有响应，可能正在处理大图或地图。',
      detail: '可以继续等待，或重新加载页面；诊断信息已写入 renderer-failures.log。',
      buttons: ['继续等待', '重新加载'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    recoveryDialogOpen = false;
    if (choice === 1) window.webContents.reload();
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) ctx.librarySnapshot?.reset();
  });
  window.on('closed', () => {
    ctx.librarySnapshot?.reset();
    if (ctx.mainWindow === window) ctx.mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, destination) => {
    if (!isAllowedAppNavigation(ctx.serverUrl, destination) && !isConnectionPageUrl(destination)) {
      event.preventDefault();
    }
  });
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, _description, validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && isAllowedAppNavigation(ctx.serverUrl, validatedUrl)) {
        void recoverConnection(ctx, owner);
      }
    },
  );
  void window.loadURL(initialUrl);
}

export function lockDownSession(ctx: DesktopContext, currentSession: Electron.Session): void {
  currentSession.setPermissionCheckHandler(() => false);
  currentSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  currentSession.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (!isAllowedAppNavigation(ctx.serverUrl, details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [desktopContentSecurityPolicy],
        },
      });
    },
  );
}
