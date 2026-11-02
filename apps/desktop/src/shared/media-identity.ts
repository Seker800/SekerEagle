import { createHash } from 'node:crypto';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TILE_COORDINATE = 1_000_000;
const MAX_TILE_LEVEL = 63;

export type DesktopLibraryMode = 'MATERIAL' | 'PHOTO';
export type DesktopMediaIdentity = (
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
) & { libraryMode?: DesktopLibraryMode };

export function createDesktopMediaUrl(media: DesktopMediaIdentity): string {
  const scope =
    media.libraryMode === undefined
      ? ''
      : `${parseLibraryMode(media.libraryMode.toLowerCase()).toLowerCase()}/`;
  const value =
    media.kind === 'RENDITION'
      ? `sekereagle-media://rendition/${scope}${media.renditionKind.toLowerCase()}/${media.assetId}/${media.renditionId}`
      : `sekereagle-media://tile/${scope}${media.assetId}/${media.pyramidId}/${media.level}/${media.x}/${media.y}`;
  const canonical = parseDesktopMediaUrl(value);
  if (canonical.kind !== media.kind) throw new Error('桌面媒体类型无效。');
  return value.toLowerCase();
}

export function parseDesktopMediaUrl(input: string): DesktopMediaIdentity {
  // URL normalizes dot segments before pathname is exposed. Reject them first,
  // so an invalid mode cannot silently become a valid legacy material URL.
  if (/(?:\/|^)(?:\.|%2e){1,2}(?:\/|$)/iu.test(input)) throw new Error('媒体地址无效。');
  const url = parseUrl(input, '媒体地址无效。');
  if (
    url.protocol !== 'sekereagle-media:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('媒体地址不受信任。');
  }

  const segments = url.pathname.split('/').filter(Boolean).map(decodePathSegment);
  const scoped =
    (url.hostname === 'rendition' && segments.length === 4) ||
    (url.hostname === 'tile' && segments.length === 6);
  const scope = scoped ? { libraryMode: parseLibraryMode(segments.shift()!) } : {};
  if (url.hostname === 'rendition' && segments.length === 3) {
    const [renditionKind, assetId, renditionId] = segments;
    return {
      ...scope,
      kind: 'RENDITION',
      renditionKind: parseRenditionKind(renditionKind),
      assetId: assertUuid(assetId),
      renditionId: assertUuid(renditionId),
    };
  }

  if (url.hostname === 'tile' && segments.length === 5) {
    const [assetId, pyramidId, level, x, y] = segments;
    return {
      ...scope,
      kind: 'TILE',
      assetId: assertUuid(assetId),
      pyramidId: assertUuid(pyramidId),
      level: parseBoundedInteger(level, MAX_TILE_LEVEL),
      x: parseBoundedInteger(x, MAX_TILE_COORDINATE),
      y: parseBoundedInteger(y, MAX_TILE_COORDINATE),
    };
  }

  throw new Error('媒体地址不在允许范围内。');
}

export function buildCacheIdentity(
  serverUrl: string,
  authenticatedOwnerId: string,
  deploymentId: string,
  media: DesktopMediaIdentity,
): string {
  const serverIdentity = normalizeServerIdentity(serverUrl);
  const ownerId = authenticatedOwnerId.trim();
  if (!ownerId || ownerId.length > 256 || hasControlCharacter(ownerId)) {
    throw new Error('认证主体无效。');
  }

  const mediaIdentity =
    media.kind === 'RENDITION'
      ? `rendition:${media.renditionKind}:${media.assetId}:${media.renditionId}`
      : `tile:${media.assetId}:${media.pyramidId}:${media.level}:${media.x}:${media.y}`;
  assertDeploymentId(deploymentId);
  return `${cacheScopeIdentity(serverIdentity, ownerId, deploymentId, media.libraryMode)}\n${mediaIdentity}`;
}

export function hashCacheIdentity(identity: string): Buffer {
  return createHash('sha256').update(identity, 'utf8').digest();
}

export function buildNamespaceId(
  serverUrl: string,
  authenticatedOwnerId: string,
  deploymentId: string,
  libraryMode: DesktopLibraryMode = 'MATERIAL',
): string {
  const serverIdentity = normalizeServerIdentity(serverUrl);
  const ownerId = authenticatedOwnerId.trim();
  if (!ownerId || ownerId.length > 256 || hasControlCharacter(ownerId)) {
    throw new Error('认证主体无效。');
  }
  assertDeploymentId(deploymentId);
  return createHash('sha256')
    .update(cacheScopeIdentity(serverIdentity, ownerId, deploymentId, libraryMode), 'utf8')
    .digest('hex');
}

function cacheScopeIdentity(
  server: string,
  owner: string,
  deployment: string,
  mode: DesktopLibraryMode = 'MATERIAL',
) {
  if (mode !== 'MATERIAL' && mode !== 'PHOTO') throw new Error('图库模式无效。');
  // v1 was exclusively MATERIAL. Preserve its existing files without ever
  // admitting PHOTO into that key space, including on a legacy request.
  return mode === 'MATERIAL'
    ? `v1\n${server}\n${deployment}\n${owner}`
    : `v2\n${server}\n${deployment}\n${owner}\nPHOTO`;
}

function parseLibraryMode(value: string): DesktopLibraryMode {
  if (value === 'material') return 'MATERIAL';
  if (value === 'photo') return 'PHOTO';
  throw new Error('图库模式无效。');
}

function assertDeploymentId(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error('deployment identity 无效。');
}

export function normalizeServerIdentity(input: string): string {
  const url = parseUrl(input, '服务器地址无效。');
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('服务器地址必须是无凭据、查询或子路径的 HTTP(S) origin。');
  }
  return url.origin.toLowerCase();
}

function assertUuid(value: string | undefined): string {
  if (!value || !UUID_V4.test(value)) throw new Error('媒体标识无效。');
  return value.toLowerCase();
}

function parseBoundedInteger(value: string | undefined, maximum: number): number {
  if (!value || !/^(0|[1-9]\d*)$/u.test(value)) throw new Error('切片坐标无效。');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error('切片坐标超出范围。');
  return parsed;
}

function parseRenditionKind(value: string | undefined): 'THUMBNAIL' | 'PREVIEW' | 'POSTER' {
  const normalized = value?.toUpperCase();
  if (normalized !== 'THUMBNAIL' && normalized !== 'PREVIEW' && normalized !== 'POSTER') {
    throw new Error('派生媒体类型无效。');
  }
  return normalized;
}

function decodePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes('/') || decoded.includes('\\') || decoded === '.' || decoded === '..') {
      throw new Error('媒体路径无效。');
    }
    return decoded;
  } catch {
    throw new Error('媒体路径编码无效。');
  }
}

function parseUrl(input: string, message: string): URL {
  try {
    return new URL(input);
  } catch {
    throw new Error(message);
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
