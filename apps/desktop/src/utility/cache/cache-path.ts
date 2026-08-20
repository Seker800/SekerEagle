import path from 'node:path';

const CACHE_HASH_BYTES = 32;

export function cacheRelativePath(keyHash: Buffer): string {
  assertCacheHash(keyHash);
  const hex = keyHash.toString('hex');
  return path.join(hex.slice(0, 3), `${hex}.media`);
}

export function cacheFilePath(cacheRoot: string, keyHash: Buffer): string {
  const resolvedRoot = path.resolve(cacheRoot);
  const resolvedFile = path.resolve(resolvedRoot, cacheRelativePath(keyHash));
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (!resolvedFile.startsWith(rootPrefix)) throw new Error('缓存路径越界。');
  return resolvedFile;
}

function assertCacheHash(keyHash: Buffer): void {
  if (!Buffer.isBuffer(keyHash) || keyHash.byteLength !== CACHE_HASH_BYTES) {
    throw new Error('缓存 key hash 必须是 32 字节。');
  }
}
