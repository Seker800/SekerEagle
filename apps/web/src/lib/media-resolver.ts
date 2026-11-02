import { libraryApiPath, type LibraryMode } from './library-api-scope';
import { t } from '../i18n';
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TILE_PATH = new RegExp(
  `^/api/(eagle|photos)/assets/(${UUID_V4})/pyramids/(${UUID_V4})/tiles/(0|[1-9]\\d*)/(0|[1-9]\\d*)/(0|[1-9]\\d*)$`,
  'i',
);
const DESKTOP_CLIPBOARD_RENDITION_URL = new RegExp(
  `^sekereagle-media://rendition/(?:(material|photo)/)?(?:thumbnail|preview)/(${UUID_V4})/(${UUID_V4})$`,
  'i',
);
export type DesktopMediaRequest = (
  | {
      kind: 'RENDITION';
      renditionKind: 'THUMBNAIL' | 'PREVIEW' | 'POSTER';
      assetId: string;
      renditionId: string;
    }
  | {
      kind: 'TILE';
      assetId: string;
      pyramidId: string;
      level: number;
      x: number;
      y: number;
    }
) & { libraryMode?: LibraryMode };
export interface SekerDesktopBridge {
  readonly version: 1;
  readonly mediaCacheVersion?: number;
  refreshSession?(): Promise<{ status: number; code: string | null }>;
  createMediaUrl(media: DesktopMediaRequest): string;
  getCacheStatus?(): Promise<DesktopCacheStatus>;
  setCacheLimitGiB?(limitGiB: number): Promise<void>;
  clearCache?(): Promise<{
    deleted: number;
    deferred: number;
  }>;
  invalidateAsset?(assetId: string): Promise<{
    deleted: number;
    deferred: number;
  }>;
  writeClipboardImage?(pngBytes: Uint8Array): Promise<void>;
  getConnectionStatus?(): Promise<DesktopConnectionStatus>;
  openConnectionManager?(locale?: 'zh-CN' | 'en-US'): Promise<void>;
  prepareAssetDrag?(assetIds: string[]): Promise<{
    token: string;
  }>;
  onAssetDragPreparationProgress?(
    listener: (progress: { completed: number; total: number }) => void,
  ): () => void;
  startPreparedAssetDrag?(token: string): void;
  cancelAssetDragPreparation?(): void;
  discardPreparedAssetDrag?(token: string): void;
  saveOriginalFile?(
    assetId: string,
    locale?: 'zh-CN' | 'en-US',
  ): Promise<{
    saved: boolean;
  }>;
  downloadOriginalFiles?(
    assetIds: string[],
    locale?: 'zh-CN' | 'en-US',
  ): Promise<{
    downloaded: number;
  }>;
}
export interface DesktopConnectionStatus {
  mode: 'AUTO' | 'LOCAL' | 'LAN' | 'PUBLIC';
  activeSlot: 'LOCAL' | 'LAN' | 'PUBLIC' | null;
  activeUrl: string | null;
  latencyMs: number | null;
}
export interface DesktopCacheStatus {
  requests?: {
    localHitCount: number;
    revalidatedHitCount: number;
    missCount: number;
    coalescedCount: number;
    errorCount: number;
    savedBytes: number;
  };
  limitBytes: number;
  globalAllocatedBytes: number;
  globalEntryCount: number;
  allocatedBytes: number;
  logicalBytes: number;
  entryCount: number;
  hitCount: number;
  missCount: number;
  savedBytes: number;
}
export type DesktopCacheBridge = Required<
  Pick<SekerDesktopBridge, 'getCacheStatus' | 'setCacheLimitGiB' | 'clearCache' | 'invalidateAsset'>
>;
export type DesktopClipboardBridge = Required<Pick<SekerDesktopBridge, 'writeClipboardImage'>>;
export type DesktopOriginalFileBridge = Required<Pick<SekerDesktopBridge, 'saveOriginalFile'>>;
export type DesktopOriginalFileDownloadBridge = Required<
  Pick<SekerDesktopBridge, 'downloadOriginalFiles'>
>;
export function getDesktopClipboardBridge(): DesktopClipboardBridge | null {
  const bridge = desktopBridge();
  return bridge && typeof bridge.writeClipboardImage === 'function'
    ? (bridge as SekerDesktopBridge & DesktopClipboardBridge)
    : null;
}
export function getDesktopOriginalFileBridge(): DesktopOriginalFileBridge | null {
  const bridge = desktopBridge();
  return bridge && typeof bridge.saveOriginalFile === 'function'
    ? (bridge as SekerDesktopBridge & DesktopOriginalFileBridge)
    : null;
}
export function getDesktopOriginalFileDownloadBridge(): DesktopOriginalFileDownloadBridge | null {
  const bridge = desktopBridge();
  return bridge && typeof bridge.downloadOriginalFiles === 'function'
    ? (bridge as SekerDesktopBridge & DesktopOriginalFileDownloadBridge)
    : null;
}
export function getDesktopCacheBridge(): DesktopCacheBridge | null {
  const bridge = desktopBridge();
  return bridge &&
    typeof bridge.getCacheStatus === 'function' &&
    typeof bridge.setCacheLimitGiB === 'function' &&
    typeof bridge.clearCache === 'function' &&
    typeof bridge.invalidateAsset === 'function'
    ? (bridge as SekerDesktopBridge & DesktopCacheBridge)
    : null;
}
export function getDesktopConnectionBridge(): Pick<
  Required<SekerDesktopBridge>,
  'getConnectionStatus' | 'openConnectionManager'
> | null {
  const bridge = desktopBridge();
  return bridge &&
    typeof bridge.getConnectionStatus === 'function' &&
    typeof bridge.openConnectionManager === 'function'
    ? (bridge as Required<SekerDesktopBridge>)
    : null;
}
export function resolveEagleRenditionUrl(
  assetId: string,
  renditionId: string,
  renditionKind: 'THUMBNAIL' | 'PREVIEW' | 'POSTER',
  libraryMode: LibraryMode = 'MATERIAL',
): string {
  const fallback = `/api/eagle/assets/${encodeURIComponent(assetId)}/renditions/${encodeURIComponent(renditionId)}`;
  return resolveMediaRequest(
    { kind: 'RENDITION', renditionKind, assetId, renditionId },
    libraryApiPath(fallback, libraryMode),
    libraryMode,
  );
}
export function resolveEagleMediaPath(path: string): string {
  const tile = TILE_PATH.exec(path);
  if (tile) {
    return resolveMediaRequest(
      {
        kind: 'TILE',
        assetId: tile[2],
        pyramidId: tile[3],
        level: Number(tile[4]),
        x: Number(tile[5]),
        y: Number(tile[6]),
      },
      path,
      tile[1] === 'photos' ? 'PHOTO' : 'MATERIAL',
    );
  }
  return path;
}
export function resolveClipboardImageUrl(url: string): string {
  if (!url.startsWith('sekereagle-media:')) return url;
  const rendition = DESKTOP_CLIPBOARD_RENDITION_URL.exec(url);
  if (!rendition) throw new Error(t('图片复制来源未通过能力校验。'));
  return libraryApiPath(
    `/api/eagle/assets/${rendition[2]}/renditions/${rendition[3]}`,
    rendition[1] === 'photo' ? 'PHOTO' : 'MATERIAL',
  );
}
function resolveMediaRequest(
  media: DesktopMediaRequest,
  fallback: string,
  libraryMode: LibraryMode,
): string {
  const bridge = desktopBridge();
  if (!bridge) return fallback;
  if (libraryMode === 'PHOTO' && bridge.mediaCacheVersion !== 2) return fallback;
  const scoped = bridge.mediaCacheVersion === 2 ? { ...media, libraryMode } : media;
  const resolved = bridge.createMediaUrl(scoped);
  if (resolved !== canonicalDesktopUrl(scoped)) throw new Error(t('桌面媒体地址未通过能力校验。'));
  return resolved;
}
function desktopBridge(): SekerDesktopBridge | null {
  const candidate = (
    globalThis as {
      sekerDesktop?: Partial<SekerDesktopBridge>;
    }
  ).sekerDesktop;
  return candidate?.version === 1 && typeof candidate.createMediaUrl === 'function'
    ? (candidate as SekerDesktopBridge)
    : null;
}
function canonicalDesktopUrl(media: DesktopMediaRequest): string {
  const scope = media.libraryMode ? `${media.libraryMode.toLowerCase()}/` : '';
  return media.kind === 'RENDITION'
    ? `sekereagle-media://rendition/${scope}${media.renditionKind.toLowerCase()}/${media.assetId}/${media.renditionId}`
    : `sekereagle-media://tile/${scope}${media.assetId}/${media.pyramidId}/${media.level}/${media.x}/${media.y}`;
}
