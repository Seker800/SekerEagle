import { contextBridge } from 'electron';
import { createDesktopMediaUrl, type DesktopMediaIdentity } from '../shared/media-identity';

contextBridge.exposeInMainWorld('sekerDesktop', {
  version: 1,
  createMediaUrl(media: DesktopMediaIdentity) {
    return createDesktopMediaUrl(media);
  },
});
