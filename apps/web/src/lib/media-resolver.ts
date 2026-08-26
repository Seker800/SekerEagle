const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TILE_PATH = new RegExp(
  `^/api/eagle/assets/(${UUID_V4})/pyramids/(${UUID_V4})/tiles/(0|[1-9]\\d*)/(0|[1-9]\\d*)/(0|[1-9]\\d*)$`,
  'i',
);
const DESKTOP_CLIPBOARD_RENDITION_URL = new RegExp(
  `^sekereagle-media://rendition/(?:thumbnail|preview)/(${UUID_V4})/(${UUID_V4})$`,
  'i',
);

export type DesktopMediaRequest =
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
    };

export interface SekerDesktopBridge {
  readonly version: 1;
  createMediaUrl(media: DesktopMediaRequest): string;
  getCacheStatus?(): Promise<DesktopCacheStatus>;
  setCacheLimitGiB?(limitGiB: number): Promise<void>;
  clearCache?(): Promise<{ deleted: number; deferred: number }>;
  invalidateAsset?(assetId: string): Promise<{ deleted: number; deferred: number }>;
  writeClipboardImage?(pngBytes: Uint8Array): Promise<void>;
  getConnectionStatus?(): Promise<DesktopConnectionStatus>;
  openConnectionManager?(): Promise<void>;
}

export interface DesktopConnectionStatus {
  mode: 'AUTO' | 'LOCAL' | 'LAN' | 'PUBLIC';
  activeSlot: 'LOCAL' | 'LAN' | 'PUBLIC' | null;
  activeUrl: string | null;
  latencyMs: number | null;
}

export interface DesktopCacheStatus {
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

export function getDesktopClipboardBridge(): DesktopClipboardBridge | null {
  const bridge = desktopBridge();
  return bridge && typeof bridge.writeClipboardImage === 'function'
    ? (bridge as SekerDesktopBridge & DesktopClipboardBridge)
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
): string {
  const fallback = `/api/eagle/assets/${encodeURIComponent(assetId)}/renditions/${encodeURIComponent(renditionId)}`;
  return resolveMediaRequest({ kind: 'RENDITION', renditionKind, assetId, renditionId }, fallback);
}

export function resolveEagleMediaPath(path: string): string {
  const tile = TILE_PATH.exec(path);
  if (tile) {
    return resolveMediaRequest(
      {
        kind: 'TILE',
        assetId: tile[1],
        pyramidId: tile[2],
        level: Number(tile[3]),
        x: Number(tile[4]),
        y: Number(tile[5]),
      },
      path,
    );
  }
  return path;
}

export function resolveClipboardImageUrl(url: string): string {
  if (!url.startsWith('sekereagle-media:')) return url;
  const rendition = DESKTOP_CLIPBOARD_RENDITION_URL.exec(url);
  if (!rendition) throw new Error('图片复制来源未通过能力校验。');
  return `/api/eagle/assets/${rendition[1]}/renditions/${rendition[2]}`;
}

function resolveMediaRequest(media: DesktopMediaRequest, fallback: string): string {
  const bridge = desktopBridge();
  if (!bridge) return fallback;
  const resolved = bridge.createMediaUrl(media);
  if (resolved !== canonicalDesktopUrl(media)) throw new Error('桌面媒体地址未通过能力校验。');
  return resolved;
}

function desktopBridge(): SekerDesktopBridge | null {
  const candidate = (globalThis as { sekerDesktop?: Partial<SekerDesktopBridge> }).sekerDesktop;
  return candidate?.version === 1 && typeof candidate.createMediaUrl === 'function'
    ? (candidate as SekerDesktopBridge)
    : null;
}

function canonicalDesktopUrl(media: DesktopMediaRequest): string {
  return media.kind === 'RENDITION'
    ? `sekereagle-media://rendition/${media.renditionKind.toLowerCase()}/${media.assetId}/${media.renditionId}`
    : `sekereagle-media://tile/${media.assetId}/${media.pyramidId}/${media.level}/${media.x}/${media.y}`;
}
