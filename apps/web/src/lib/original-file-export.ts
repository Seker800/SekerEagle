import { t } from '../i18n';
import { getEagleAssetContentUrl } from './eagle-api';
import {
  getDesktopOriginalFileBridge,
  getDesktopOriginalFileDownloadBridge,
  type DesktopOriginalFileBridge,
  type DesktopOriginalFileDownloadBridge,
} from './media-resolver';
export interface OriginalFileTarget {
  id: string;
  originalName: string;
}
type TriggerBrowserDownload = (url: string, fileName: string) => void;
interface SaveOriginalFileDependencies {
  desktopBridge?: DesktopOriginalFileBridge | null;
  triggerBrowserDownload?: TriggerBrowserDownload;
}
interface DownloadOriginalFilesDependencies {
  desktopBridge?: DesktopOriginalFileDownloadBridge | null;
  triggerBrowserDownload?: TriggerBrowserDownload;
}
export function saveOriginalFile(
  target: OriginalFileTarget,
  dependencies: SaveOriginalFileDependencies = {},
): Promise<{
  saved: boolean;
}> {
  const desktopBridge =
    dependencies.desktopBridge === undefined
      ? getDesktopOriginalFileBridge()
      : dependencies.desktopBridge;
  if (desktopBridge) return desktopBridge.saveOriginalFile(target.id);
  (dependencies.triggerBrowserDownload ?? triggerBrowserDownload)(
    getEagleAssetContentUrl(target.id),
    target.originalName,
  );
  return Promise.resolve({ saved: true });
}
export function downloadOriginalFiles(
  targets: readonly OriginalFileTarget[],
  dependencies: DownloadOriginalFilesDependencies = {},
): Promise<{
  downloaded: number;
}> {
  if (targets.length < 2) return Promise.reject(new Error(t('批量下载至少需要选择 2 项素材。')));
  const desktopBridge =
    dependencies.desktopBridge === undefined
      ? getDesktopOriginalFileDownloadBridge()
      : dependencies.desktopBridge;
  if (desktopBridge) return desktopBridge.downloadOriginalFiles(targets.map(({ id }) => id));
  const download = dependencies.triggerBrowserDownload ?? triggerBrowserDownload;
  targets.forEach((target) => download(getEagleAssetContentUrl(target.id), target.originalName));
  return Promise.resolve({ downloaded: targets.length });
}
function triggerBrowserDownload(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeDownloadName(fileName);
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}
function sanitizeDownloadName(fileName: string): string {
  return fileName.replace(/[\\/\0]/gu, '_').trim() || 'download';
}
