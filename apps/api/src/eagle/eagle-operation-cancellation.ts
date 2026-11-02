import type { LibraryMode, Prisma } from '@prisma/client';

export class OperationCancelledError extends Error {
  constructor() {
    super('OPERATION_CANCELLED');
  }
}
/** All publishers and cancellation use operation -> item row order.
 * The row stays locked until the original publication transaction commits:
 * cancellation stops claimed work, while an already publishing atomic unit finishes.
 */
export async function lockOperationPublication(
  tx: Prisma.TransactionClient,
  scope: { ownerId: string; libraryMode: LibraryMode; operationId: string },
  allowCancelled = false,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ cancelled: boolean }>>`
    SELECT "cancelRequestedAt" IS NOT NULL AS cancelled
    FROM "EagleAssetOperation"
    WHERE id=${scope.operationId} AND "ownerId"=${scope.ownerId}
      AND "libraryMode"=${scope.libraryMode}::"LibraryMode"
    FOR UPDATE
  `;
  // Item -> operation is a scoped FK; a missing operation cannot own a valid lease.
  if (!allowCancelled && rows.some((row) => row.cancelled)) throw new OperationCancelledError();
}
