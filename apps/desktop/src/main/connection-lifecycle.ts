import type { AuthenticatedOwner } from './authenticated-owner';
import { connectionPageUrl } from './desktop-locale';
import type { DesktopContext } from './desktop-context';
import type { DesktopConnectionSnapshot } from './connection-service';
import { createMediaController } from './media-protocol';
import { expireCacheAuthorizations } from './cache-process';

export async function applyConnection(
  ctx: DesktopContext,
  snapshot: DesktopConnectionSnapshot,
  owner: AuthenticatedOwner,
): Promise<void> {
  if (!snapshot.active) {
    await ctx.mainWindow?.loadURL(connectionPageUrl(ctx.desktopLocale));
    return;
  }
  const changed = ctx.serverUrl !== snapshot.active.url;
  ctx.serverUrl = snapshot.active.url;
  if (changed) {
    owner.invalidate();
    ctx.clearPreparedOriginalDrags();
    void expireCacheAuthorizations();
    ctx.mediaController = createMediaController(ctx, owner);
  }
  if (ctx.mainWindow?.webContents.getURL() !== ctx.serverUrl)
    await ctx.mainWindow?.loadURL(ctx.serverUrl);
}

export async function recoverConnection(
  ctx: DesktopContext,
  owner: AuthenticatedOwner,
): Promise<void> {
  if (ctx.connectionRecovery) return ctx.connectionRecovery;
  ctx.connectionRecovery = ctx
    .currentConnectionService()
    .retry()
    .then((snapshot) => applyConnection(ctx, snapshot, owner))
    .finally(() => {
      ctx.connectionRecovery = null;
    });
  return ctx.connectionRecovery;
}
