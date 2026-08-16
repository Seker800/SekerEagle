import { randomUUID } from 'node:crypto';

const OWNER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAssetObjectKey(ownerId: string, suffix = 'original'): string {
  if (!OWNER_ID_PATTERN.test(ownerId)) throw new Error('ownerId 必须是 UUID');
  const leafName = suffix.split(/[\\/]/).at(-1) ?? '';
  const safeSuffix = leafName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!safeSuffix || safeSuffix === '.' || safeSuffix === '..') throw new Error('对象后缀无效');
  return `users/${ownerId}/assets/${randomUUID()}/${safeSuffix}`;
}

export function assertOwnedObjectKey(ownerId: string, objectKey: string): void {
  if (!objectKey.startsWith(`users/${ownerId}/`)) throw new Error('对象不属于当前用户');
}
