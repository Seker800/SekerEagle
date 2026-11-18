import { randomUUID } from 'node:crypto';
import {
  app,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type NativeImage,
} from 'electron';
import type { AuthenticatedOwner } from '../authenticated-owner';
import type { DesktopContext } from '../desktop-context';
import { buildNamespaceId } from '../../shared/media-identity';
import {
  ORIGINAL_DRAG_EXPORT_TTL_MS,
  type OriginalDragExporter,
  parseAssetDragInput,
  parsePreparedDragToken,
  parseLibraryDragRequest,
  type OriginalLibraryMode,
} from '../original-drag-export';

export function registerOriginalDragIpc(
  ctx: DesktopContext,
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
  let dragPreparationController: AbortController | null = null;
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

  const prepareDrag = async (
    event: IpcMainInvokeEvent,
    input: unknown,
    libraryMode: OriginalLibraryMode,
  ) => {
    ctx.assertTrustedIpcSender(event);
    if (dragInFlight) throw new Error('已有原文件正在准备，请稍候。');
    dragInFlight = true;
    const preparationController = new AbortController();
    dragPreparationController = preparationController;
    const dragServerUrl = ctx.serverUrl;
    let prepared: Awaited<ReturnType<OriginalDragExporter['prepare']>> | null = null;
    let preparedToken: string | null = null;
    try {
      const assetIds = parseAssetDragInput(input);
      const identity = await owner.get();
      if (!identity) throw new Error('需要重新登录。');
      const namespaceId = buildNamespaceId(identity.ownerId, identity.deploymentId);
      prepared = await exporter.prepare(
        namespaceId,
        assetIds,
        preparationController.signal,
        (progress) => {
          if (dragPreparationController === preparationController && !event.sender.isDestroyed()) {
            event.sender.send('desktop:asset-drag-preparation-progress', progress);
          }
        },
        libraryMode,
      );
      const icon = await app.getFileIcon(prepared.files[0], { size: 'normal' });
      const currentIdentity = await owner.get();
      if (
        dragServerUrl !== ctx.serverUrl ||
        !currentIdentity ||
        currentIdentity.ownerId !== identity.ownerId ||
        currentIdentity.deploymentId !== identity.deploymentId
      ) {
        throw new Error('账号或服务器已切换，请重新拖动素材。');
      }
      ctx.assertTrustedIpcSender(event);
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
      if (dragPreparationController === preparationController) dragPreparationController = null;
      dragInFlight = false;
    }
  };
  ipcMain.handle('desktop:prepare-asset-drag', (event, input: unknown) =>
    prepareDrag(event, input, 'MATERIAL'),
  );
  ipcMain.handle('desktop:prepare-library-asset-drag', (event, input: unknown) => {
    ctx.assertTrustedIpcSender(event);
    const request = parseLibraryDragRequest(input);
    return prepareDrag(event, request.assetIds, request.libraryMode);
  });

  ipcMain.on('desktop:cancel-asset-drag-preparation', (event) => {
    try {
      ctx.assertTrustedIpcSender(event);
      dragPreparationController?.abort(new Error('原文件拖拽已取消。'));
    } catch {
      return;
    }
  });

  ipcMain.on('desktop:discard-prepared-asset-drag', (event, input: unknown) => {
    try {
      ctx.assertTrustedIpcSender(event);
      removePreparedDrag(parsePreparedDragToken(input));
    } catch {
      return;
    }
  });

  ipcMain.on('desktop:start-prepared-asset-drag', (event, input: unknown) => {
    try {
      ctx.assertTrustedIpcSender(event);
      const token = parsePreparedDragToken(input);
      const entry = preparedDrags.get(token);
      if (!entry || entry.serverUrl !== ctx.serverUrl) {
        if (entry) removePreparedDrag(token);
        return;
      }
      startNativeDrag(event, entry.prepared, entry.icon);
    } catch {
      return;
    }
  });

  return () => {
    dragPreparationController?.abort(new Error('原文件拖拽已取消。'));
    const entries = [...preparedDrags.values()];
    preparedDrags.clear();
    for (const entry of entries) {
      clearTimeout(entry.cleanupTimer);
      void exporter.remove(entry.prepared).catch(() => undefined);
    }
  };
}
