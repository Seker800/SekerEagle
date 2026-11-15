import { runTransferWork, transferCopyBudget } from './eagle-transfer-work';
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
/** Persist directories without a separator; append one only when addressing a child. */
export function pyramidStoragePrefix(prefix: string): string {
  return prefix.replace(/\/+$/, '');
}

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
  storage: Pick<ObjectStorageService, 'copyObject' | 'listObjectSizes'>,
  ownerId: string,
  p: TransferPyramid,
) {
  assertOwnedObjectKey(ownerId, p.storagePrefix);
  assertOwnedObjectKey(ownerId, p.targetPrefix);
  const tiles = transferPyramidTiles(p);
  const sourcePrefix = `${pyramidStoragePrefix(p.storagePrefix)}/`;
  // One bounded listing replaces a HEAD per tile; source renditions are immutable once READY.
  const sourceSizes = await storage.listObjectSizes(sourcePrefix);
  let total = 0n;
  for (const relative of tiles) {
    const size = sourceSizes.get(sourcePrefix + relative);
    if (size === undefined) throw new ConflictException('切片读取校验失败。');
    total += size;
  }
  if (total !== BigInt(p.size)) throw new ConflictException('切片总大小校验失败。');
  await runTransferWork(tiles, async (relative) =>
    transferCopyBudget.run(async () => {
      await storage.copyObject(sourcePrefix + relative, p.targetPrefix + relative);
    }),
  );
  // One bounded target listing verifies the copied set without two HEADs per tile.
  const targetSizes = await storage.listObjectSizes(p.targetPrefix);
  let copied = 0n;
  for (const relative of tiles) {
    const size = targetSizes.get(p.targetPrefix + relative);
    if (size === undefined) throw new ConflictException('切片复制校验失败。');
    copied += size;
  }
  if (copied !== total) throw new ConflictException('切片复制校验失败。');
}
