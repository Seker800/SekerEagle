import { ipcMain } from 'electron';
import type { AuthenticatedOwner } from '../authenticated-owner';
import { applyConnection } from '../connection-lifecycle';
import { connectionPageUrl, normalizeDesktopLocale } from '../desktop-locale';
import type { DesktopContext } from '../desktop-context';

export function registerConnectionIpc(ctx: DesktopContext, owner: AuthenticatedOwner): void {
  ipcMain.handle('desktop:get-connection-status', (event) => {
    ctx.assertTrustedConnectionSender(event);
    const snapshot = ctx.currentConnections();
    return {
      mode: snapshot.settings.mode,
      activeSlot: snapshot.active?.slot ?? null,
      activeUrl: snapshot.active?.url ?? null,
      latencyMs: snapshot.active?.latencyMs ?? null,
    };
  });
  ipcMain.handle('desktop:get-connection-manager-state', (event) => {
    ctx.assertConnectionPageSender(event);
    return ctx.currentConnections();
  });
  ipcMain.handle('desktop:test-connections', async (event, input: unknown) => {
    ctx.assertConnectionPageSender(event);
    return ctx.currentConnectionService().test(input);
  });
  ipcMain.handle('desktop:retry-connections', async (event) => {
    ctx.assertConnectionPageSender(event);
    const snapshot = await ctx.currentConnectionService().retry();
    if (snapshot.active)
      setTimeout(() => void applyConnection(ctx, snapshot, owner), 0).unref();
    return snapshot;
  });
  ipcMain.handle('desktop:save-connections', async (event, input: unknown) => {
    ctx.assertConnectionPageSender(event);
    const snapshot = await ctx.currentConnectionService().save(input);
    if (snapshot.active) {
      setTimeout(() => void applyConnection(ctx, snapshot, owner), 0).unref();
    }
    return snapshot;
  });
  ipcMain.handle('desktop:reset-deployment-binding', async (event) => {
    ctx.assertConnectionPageSender(event);
    const snapshot = await ctx.currentConnectionService().resetDeploymentBinding();
    if (snapshot.active) {
      setTimeout(() => void applyConnection(ctx, snapshot, owner), 0).unref();
    }
    return snapshot;
  });
  ipcMain.handle('desktop:open-connection-manager', async (event, requestedLocale: unknown) => {
    ctx.assertTrustedConnectionSender(event);
    ctx.desktopLocale = normalizeDesktopLocale(requestedLocale ?? ctx.desktopLocale);
    await ctx.mainWindow?.loadURL(connectionPageUrl(ctx.desktopLocale));
  });
  ipcMain.handle('desktop:cancel-connection-manager', async (event) => {
    ctx.assertConnectionPageSender(event);
    const active = ctx.currentConnections().active;
    if (active) await ctx.mainWindow?.loadURL(active.url);
  });
}
