import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { AuthenticatedOwner } from '../authenticated-owner';
import type { DesktopContext } from '../desktop-context';
import { buildNamespaceId } from '../../shared/media-identity';
import { desktopText, normalizeDesktopLocale } from '../desktop-locale';
import { copyPreparedFilesToDirectory } from '../original-file-destination';
import { type OriginalDragExporter, parseAssetDragInput } from '../original-drag-export';

async function assertOriginalAccessStillCurrent(
  ctx: DesktopContext,
  event: IpcMainInvokeEvent,
  owner: AuthenticatedOwner,
  expectedServerUrl: string,
  identity: { ownerId: string; deploymentId: string },
): Promise<void> {
  const currentIdentity = await owner.get();
  if (
    expectedServerUrl !== ctx.serverUrl ||
    !currentIdentity ||
    currentIdentity.ownerId !== identity.ownerId ||
    currentIdentity.deploymentId !== identity.deploymentId
  ) {
    throw new Error('账号或服务器已切换，请重新导出素材。');
  }
  ctx.assertTrustedIpcSender(event);
}

export function registerOriginalFileExportIpc(
  ctx: DesktopContext,
  owner: AuthenticatedOwner,
  exporter: OriginalDragExporter,
): void {
  let exportInFlight = false;
  ipcMain.handle('desktop:save-original-file', async (event, input: unknown, locale: unknown) => {
    ctx.assertTrustedIpcSender(event);
    const requestedLocale = normalizeDesktopLocale(locale ?? ctx.desktopLocale);
    if (exportInFlight) throw new Error('已有原文件正在导出，请稍候。');
    exportInFlight = true;
    const saveServerUrl = ctx.serverUrl;
    let prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>> | null = null;
    try {
      const [assetId] = parseAssetDragInput([input]);
      const identity = await owner.get();
      if (!identity) throw new Error('需要重新登录。');
      prepared = await exporter.prepare(buildNamespaceId(identity.ownerId, identity.deploymentId), [
        assetId,
      ]);
      await assertOriginalAccessStillCurrent(ctx, event, owner, saveServerUrl, identity);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('桌面窗口不可用。');
      const result = await dialog.showSaveDialog(window, {
        title: desktopText(requestedLocale, 'saveOriginalTitle'),
        buttonLabel: desktopText(requestedLocale, 'save'),
        defaultPath: path.join(app.getPath('downloads'), path.basename(prepared.files[0])),
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await assertOriginalAccessStillCurrent(ctx, event, owner, saveServerUrl, identity);
      await copyFile(prepared.files[0], result.filePath);
      return { saved: true };
    } finally {
      if (prepared) await exporter.remove(prepared).catch(() => undefined);
      exportInFlight = false;
    }
  });

  ipcMain.handle(
    'desktop:download-original-files',
    async (event, input: unknown, locale: unknown) => {
      ctx.assertTrustedIpcSender(event);
      const requestedLocale = normalizeDesktopLocale(locale ?? ctx.desktopLocale);
      if (exportInFlight) throw new Error('已有原文件正在导出，请稍候。');
      const assetIds = parseAssetDragInput(input);
      if (assetIds.length < 2) throw new Error('批量下载至少需要选择 2 项素材。');
      exportInFlight = true;
      const downloadServerUrl = ctx.serverUrl;
      let prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>> | null = null;
      try {
        const identity = await owner.get();
        if (!identity) throw new Error('需要重新登录。');
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) throw new Error('桌面窗口不可用。');
        const result = await dialog.showOpenDialog(window, {
          title: desktopText(requestedLocale, 'downloadFolderTitle'),
          buttonLabel: desktopText(requestedLocale, 'downloadHere'),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || result.filePaths.length !== 1) return { downloaded: 0 };
        const destinationDirectory = result.filePaths[0]!;
        await assertOriginalAccessStillCurrent(ctx, event, owner, downloadServerUrl, identity);
        prepared = await exporter.prepare(
          buildNamespaceId(identity.ownerId, identity.deploymentId),
          assetIds,
        );
        await assertOriginalAccessStillCurrent(ctx, event, owner, downloadServerUrl, identity);
        const copied = await copyPreparedFilesToDirectory(prepared.files, destinationDirectory);
        return { downloaded: copied.length };
      } finally {
        if (prepared) await exporter.remove(prepared).catch(() => undefined);
        exportInFlight = false;
      }
    },
  );
}
