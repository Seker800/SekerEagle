import { ConflictException } from '@nestjs/common';
import type { EagleImagePyramid } from '@prisma/client';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { assertOwnedObjectKey } from '../storage/object-key';
import { PYRAMID_PROCESSOR_VERSION } from './media-job-plan';
export type TransferPyramid = Pick<
  EagleImagePyramid,
  | 'id'
  | 'revision'
  | 'processorVersion'
  | 'storagePrefix'
  | 'width'
  | 'height'
  | 'tileSize'
  | 'overlap'
  | 'format'
  | 'maxLevel'
  | 'tileCount'
> & {
  size: string;
  targetPrefix: string;
  completedAt: string | null;
};
export function planTransferPyramid(
  ownerId: string,
  targetId: string,
  revision: number,
  rows: EagleImagePyramid[],
): TransferPyramid | undefined {
  const row = rows.find(
    (p) =>
      p.revision === revision &&
      p.status === 'READY' &&
      p.processorVersion === PYRAMID_PROCESSOR_VERSION &&
      p.format === 'webp',
  );
  if (!row) return;
  assertOwnedObjectKey(ownerId, row.storagePrefix);
  return {
    id: row.id,
    revision: row.revision,
    processorVersion: row.processorVersion,
    storagePrefix: row.storagePrefix,
    width: row.width,
    height: row.height,
    tileSize: row.tileSize,
    overlap: row.overlap,
    format: row.format,
    maxLevel: row.maxLevel,
    tileCount: row.tileCount,
    size: String(row.byteSize),
    targetPrefix: `users/${ownerId}/assets/${targetId}/pyramids/1/transfer-${row.id}/`,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
export function transferPyramidTiles(p: TransferPyramid) {
  if (
    !Number.isSafeInteger(p.width) ||
    !Number.isSafeInteger(p.height) ||
    p.width < 1 ||
    p.height < 1 ||
    p.maxLevel !== Math.ceil(Math.log2(Math.max(p.width, p.height))) ||
    p.maxLevel > 20 ||
    p.tileSize < 1 ||
    p.tileCount > 100000
  )
    throw new ConflictException('切片描述无效。');
  const tiles: string[] = [];
  for (let level = 0; level <= p.maxLevel; level++) {
    const scale = 2 ** (p.maxLevel - level);
    const width = Math.ceil(p.width / scale),
      height = Math.ceil(p.height / scale);
    for (let y = 0; y < Math.ceil(height / p.tileSize); y++)
      for (let x = 0; x < Math.ceil(width / p.tileSize); x++) {
        if (tiles.length >= 100000) throw new ConflictException('切片数量超出迁移预算。');
        tiles.push(`${level}/${x}_${y}.${p.format}`);
      }
  }
  if (tiles.length !== p.tileCount) throw new ConflictException('切片数量与描述不一致。');
  return tiles;
}
export async function copyTransferPyramid(
  storage: Pick<ObjectStorageService, 'headObject' | 'copyObject'>,
  ownerId: string,
  p: TransferPyramid,
) {
  assertOwnedObjectKey(ownerId, p.storagePrefix);
  assertOwnedObjectKey(ownerId, p.targetPrefix);
  const tiles = transferPyramidTiles(p);
  let cursor = 0,
    total = 0n;
  await Promise.all(
    Array.from({ length: Math.min(4, tiles.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= tiles.length) return;
        const relative = tiles[index]!;
        const sourceKey = `${p.storagePrefix.replace(/\/$/, '')}/${relative}`,
          targetKey = p.targetPrefix + relative;
        const before = await storage.headObject(sourceKey);
        const size = BigInt(before.ContentLength ?? -1);
        if (size < 0n) throw new ConflictException('切片读取校验失败。');
        await storage.copyObject(sourceKey, targetKey);
        const after = await storage.headObject(targetKey);
        if (BigInt(after.ContentLength ?? -1) !== size)
          throw new ConflictException('切片复制校验失败。');
        total += size;
      }
    }),
  );
  if (total !== BigInt(p.size)) throw new ConflictException('切片总大小校验失败。');
}
