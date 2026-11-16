import { ipcMain, shell } from 'electron';
import type { AuthenticatedOwner } from '../authenticated-owner';
import type { DesktopContext } from '../desktop-context';
import type { DesktopSettingsStore } from '../desktop-settings';
import { accountCacheNamespaces, readAccountCacheStats, removeAccountCache } from '../account-media-cache';
import { availableBytesForPath, ensureCacheDirectory } from '../cache-filesystem';
import { currentCache, currentDesktopCacheRoot, setCacheLimitBytes } from '../cache-process';
import { emptyCacheRequestStats } from '../media-cache-controller';

export function registerCacheIpc(
  ctx: DesktopContext,
  owner: AuthenticatedOwner,
  settings: DesktopSettingsStore,
): void {
  const namespaces = async (
    event: Electron.IpcMainInvokeEvent,
    allowConnectionPage = false,
  ): Promise<string[]> => {
    if (allowConnectionPage) ctx.assertTrustedConnectionSender(event);
    else ctx.assertTrustedIpcSender(event);
    const identity = await owner.get();
    if (!identity) throw new Error('需要重新登录。');
    return accountCacheNamespaces(ctx.serverUrl, identity);
  };
  ipcMain.handle('desktop:cache-status', async (event) => {
    const namespaceIds = await namespaces(event);
    const [namespaceStats, globalStats, currentSettings] = await Promise.all([
      readAccountCacheStats(
        currentCache(),
        namespaceIds,
        (namespace) => ctx.mediaController?.getRequestStats(namespace) ?? emptyCacheRequestStats(),
      ),
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
    ctx.assertConnectionPageSender(event);
    const cacheRoot = currentDesktopCacheRoot();
    const [globalStats, currentSettings, availableBytes, identity] = await Promise.all([
      currentCache().getStats(),
      settings.load(),
      availableBytesForPath(cacheRoot),
      owner.get(),
    ]);
    const currentAccountStats = identity
      ? await readAccountCacheStats(
          currentCache(),
          accountCacheNamespaces(ctx.serverUrl, identity),
          (namespace) =>
            ctx.mediaController?.getRequestStats(namespace) ?? emptyCacheRequestStats(),
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
    ctx.assertTrustedConnectionSender(event);
    if (typeof limitGiB !== 'number') throw new Error('缓存容量无效。');
    const updated = await settings.setCacheLimitGiB(limitGiB);
    setCacheLimitBytes(updated.cacheLimitBytes);
    await currentCache().setLimitBytes(updated.cacheLimitBytes);
  });
  ipcMain.handle('desktop:clear-cache', async (event) =>
    removeAccountCache(currentCache(), await namespaces(event, true)),
  );
  ipcMain.handle('desktop:open-cache-folder', async (event) => {
    ctx.assertConnectionPageSender(event);
    const cacheRoot = currentDesktopCacheRoot();
    await ensureCacheDirectory(cacheRoot);
    const error = await shell.openPath(cacheRoot);
    if (error) throw new Error(`无法打开缓存目录：${error}`);
  });
  ipcMain.handle('desktop:invalidate-asset', async (event, assetId: unknown) => {
    if (typeof assetId !== 'string') throw new Error('资源标识无效。');
    const scope = await namespaces(event);
    ctx.librarySnapshot?.invalidateAsset(assetId);
    return removeAccountCache(currentCache(), scope, assetId);
  });
}
