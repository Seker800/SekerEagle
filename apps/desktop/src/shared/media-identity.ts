import { createHash } from 'node:crypto';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TILE_COORDINATE = 1_000_000;
const MAX_TILE_LEVEL = 63;

export type DesktopMediaIdentity =
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

export function createDesktopMediaUrl(media: DesktopMediaIdentity): string {
  const value =
    media.kind === 'RENDITION'
      ? `sekereagle-media://rendition/${media.renditionKind.toLowerCase()}/${media.assetId}/${media.renditionId}`
      : `sekereagle-media://tile/${media.assetId}/${media.pyramidId}/${media.level}/${media.x}/${media.y}`;
  const canonical = parseDesktopMediaUrl(value);
  if (canonical.kind !== media.kind) throw new Error('桌面媒体类型无效。');
  return value.toLowerCase();
}

export function parseDesktopMediaUrl(input: string): DesktopMediaIdentity {
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
  if (url.hostname === 'rendition' && segments.length === 3) {
    const [renditionKind, assetId, renditionId] = segments;
    return {
      kind: 'RENDITION',
      renditionKind: parseRenditionKind(renditionKind),
      assetId: assertUuid(assetId),
      renditionId: assertUuid(renditionId),
    };
  }

  if (url.hostname === 'tile' && segments.length === 5) {
    const [assetId, pyramidId, level, x, y] = segments;
    return {
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
  return `v1\n${serverIdentity}\n${deploymentId}\n${ownerId}\n${mediaIdentity}`;
}

export function hashCacheIdentity(identity: string): Buffer {
  return createHash('sha256').update(identity, 'utf8').digest();
}

export function buildNamespaceId(
  serverUrl: string,
  authenticatedOwnerId: string,
  deploymentId: string,
): string {
  const serverIdentity = normalizeServerIdentity(serverUrl);
  const ownerId = authenticatedOwnerId.trim();
  if (!ownerId || ownerId.length > 256 || hasControlCharacter(ownerId)) {
    throw new Error('认证主体无效。');
  }
  assertDeploymentId(deploymentId);
  return createHash('sha256')
    .update(`v1\n${serverIdentity}\n${deploymentId}\n${ownerId}`, 'utf8')
    .digest('hex');
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
