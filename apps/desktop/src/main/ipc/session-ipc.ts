import { app, ipcMain } from 'electron';
import type { AuthenticatedOwner } from '../authenticated-owner';
import type { DesktopContext } from '../desktop-context';
import { expireCacheAuthorizations } from '../cache-process';
import { recoverConnection } from '../connection-lifecycle';

export function registerSessionIpc(ctx: DesktopContext): void {
  ipcMain.handle('desktop:refresh-session', async (event) => {
    ctx.assertTrustedIpcSender(event);
    const response = await ctx.currentBrowserSession().refreshSession();
    const body: unknown = response.ok ? null : await response.json().catch(() => null);
    return {
      status: response.status,
      code:
        body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
          ? body.code
          : null,
    };
  });
  ipcMain.handle('desktop:app-info', (event) => {
    ctx.assertTrustedIpcSender(event);
    return { version: app.getVersion(), platform: process.platform };
  });
}

export function registerNetworkOnlineIpc(ctx: DesktopContext, owner: AuthenticatedOwner): void {
  ipcMain.on('desktop:network-online', (event) => {
    try {
      ctx.assertTrustedIpcSender(event);
    } catch {
      return;
    }
    ctx.librarySnapshot?.reset();
    owner.invalidate();
    void expireCacheAuthorizations();
    void recoverConnection(ctx, owner);
  });
}
