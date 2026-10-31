import { ConflictException } from '@nestjs/common';
import type { Prisma, LibraryMode } from '@prisma/client';
import type { Item } from './eagle-duplicate-model';
export async function completeDuplicateItem(
  tx: Prisma.TransactionClient,
  item: Item,
  libraryMode: LibraryMode,
) {
  const result = await tx.eagleAssetOperationItem.updateMany({
    where: {
      id: item.id,
      ownerId: item.ownerId,
      libraryMode: libraryMode,
      status: 'RUNNING',
      leaseVersion: item.leaseVersion,
      leaseUntil: { gt: new Date() },
    },
    data: { status: 'COMPLETED', leaseUntil: null },
  });
  if (result.count !== 1) throw new ConflictException('操作租约已变化。');
}
