import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { DesktopBrowserSession } from './browser-session';
import type { DesktopConnectionService, DesktopConnectionSnapshot } from './connection-service';
import type { DesktopLocale } from './desktop-locale';
import type { MediaCacheController } from './media-cache-controller';
import type { MediaSnapshotAuthorization } from './media-snapshot-authorization';
import { isConnectionPageUrl } from './connection-page-protocol';
import { isAllowedAppNavigation } from './navigation-policy';

/**
 * Shared mutable state for the desktop main process. Keeping it in one place lets
 * window, IPC and protocol modules use the same server/account/session boundary.
 */
export class DesktopContext {
  desktopLocale: DesktopLocale = 'zh-CN';
  mainWindow: BrowserWindow | null = null;
  connectionService: DesktopConnectionService | null = null;
  browserSession: DesktopBrowserSession | null = null;
  librarySnapshot: MediaSnapshotAuthorization | null = null;
  mediaController: MediaCacheController | null = null;
  connectionRecovery: Promise<void> | null = null;
  clearPreparedOriginalDrags: () => void = () => undefined;
  shuttingDown = false;

  constructor(public serverUrl: string) {}

  currentConnectionService(): DesktopConnectionService {
    if (!this.connectionService) throw new Error('连接管理尚未初始化。');
    return this.connectionService;
  }

  currentBrowserSession(): DesktopBrowserSession {
    if (!this.browserSession) throw new Error('桌面登录会话尚未初始化。');
    return this.browserSession;
  }

  currentConnections(): DesktopConnectionSnapshot {
    const snapshot = this.currentConnectionService().current();
    if (!snapshot) throw new Error('连接状态尚未初始化。');
    return snapshot;
  }

  assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
    const senderUrl = event.senderFrame?.url;
    if (
      event.sender !== this.mainWindow?.webContents ||
      !senderUrl ||
      !isAllowedAppNavigation(this.serverUrl, senderUrl)
    ) {
      throw new Error('拒绝不受信任的桌面调用。');
    }
  }

  assertTrustedConnectionSender(event: IpcMainInvokeEvent): void {
    const senderUrl = event.senderFrame?.url;
    if (
      event.sender !== this.mainWindow?.webContents ||
      !senderUrl ||
      (!isAllowedAppNavigation(this.serverUrl, senderUrl) && !isConnectionPageUrl(senderUrl))
    ) {
      throw new Error('拒绝不受信任的连接管理调用。');
    }
  }

  assertConnectionPageSender(event: IpcMainInvokeEvent): void {
    const senderUrl = event.senderFrame?.url;
    if (
      event.sender !== this.mainWindow?.webContents ||
      !senderUrl ||
      !isConnectionPageUrl(senderUrl)
    ) {
      throw new Error('拒绝不受信任的连接配置调用。');
    }
  }
}
