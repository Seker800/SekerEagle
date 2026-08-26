import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopMediaUrl, type DesktopMediaIdentity } from '../shared/media-identity';
import { parseAssetDragInput } from '../main/original-drag-export';

(
  globalThis as unknown as { addEventListener(type: 'online', listener: () => void): void }
).addEventListener('online', () => {
  ipcRenderer.send('desktop:network-online');
});

contextBridge.exposeInMainWorld('sekerDesktop', {
  version: 1,
  createMediaUrl(media: DesktopMediaIdentity) {
    return createDesktopMediaUrl(media);
  },
  getCacheStatus() {
    return ipcRenderer.invoke('desktop:cache-status');
  },
  getCacheManagerStatus() {
    return ipcRenderer.invoke('desktop:get-cache-manager-status');
  },
  setCacheLimitGiB(limitGiB: number) {
    return ipcRenderer.invoke('desktop:set-cache-limit', limitGiB);
  },
  clearCache() {
    return ipcRenderer.invoke('desktop:clear-cache');
  },
  openCacheFolder() {
    return ipcRenderer.invoke('desktop:open-cache-folder');
  },
  invalidateAsset(assetId: string) {
    return ipcRenderer.invoke('desktop:invalidate-asset', assetId);
  },
  writeClipboardImage(pngBytes: Uint8Array) {
    return ipcRenderer.invoke('desktop:write-clipboard-image', {
      contentType: 'image/png',
      bytes: pngBytes,
    });
  },
  getConnectionStatus() {
    return ipcRenderer.invoke('desktop:get-connection-status');
  },
  getConnectionManagerState() {
    return ipcRenderer.invoke('desktop:get-connection-manager-state');
  },
  testConnections(input: unknown) {
    return ipcRenderer.invoke('desktop:test-connections', input);
  },
  saveConnections(input: unknown) {
    return ipcRenderer.invoke('desktop:save-connections', input);
  },
  resetDeploymentBinding() {
    return ipcRenderer.invoke('desktop:reset-deployment-binding');
  },
  openConnectionManager() {
    return ipcRenderer.invoke('desktop:open-connection-manager');
  },
  cancelConnectionManager() {
    return ipcRenderer.invoke('desktop:cancel-connection-manager');
  },
  startAssetDrag(assetIds: unknown) {
    return ipcRenderer.invoke('desktop:start-asset-drag', parseAssetDragInput(assetIds));
  },
});
