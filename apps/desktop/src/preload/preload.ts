import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopMediaUrl, type DesktopMediaIdentity } from '../shared/media-identity';

contextBridge.exposeInMainWorld('sekerDesktop', {
  version: 1,
  createMediaUrl(media: DesktopMediaIdentity) {
    return createDesktopMediaUrl(media);
  },
  getCacheStatus() {
    return ipcRenderer.invoke('desktop:cache-status');
  },
  setCacheLimitGiB(limitGiB: number) {
    return ipcRenderer.invoke('desktop:set-cache-limit', limitGiB);
  },
  clearCache() {
    return ipcRenderer.invoke('desktop:clear-cache');
  },
  invalidateAsset(assetId: string) {
    return ipcRenderer.invoke('desktop:invalidate-asset', assetId);
  },
});
