import { inheritPhotoEditedCopy } from '@sekereagle/library-persistence';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LibraryIdentity, LibraryRevisionObserver } from '../eagle/library-mode';

/** Photography owns its projections; the shared upload service only emits a revision event. */
@Injectable()
export class PhotoRevisionObserver implements LibraryRevisionObserver {
  async beforeEditedCopy(tx: Prisma.TransactionClient, scope: LibraryIdentity) {
    if (scope.libraryMode !== 'PHOTO') throw new Error('PHOTO_REVISION_SCOPE_MISMATCH');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${scope.ownerId}`}))`;
  }

  async onEditedCopyCreated(
    tx: Prisma.TransactionClient,
    scope: LibraryIdentity,
    copy: { sourceAssetId: string; assetId: string; mediaRevision: number },
  ) {
    return inheritPhotoEditedCopy(tx, scope, copy);
  }

  async onOriginalReplaced(tx: Prisma.TransactionClient, scope: LibraryIdentity, assetId: string) {
    if (scope.libraryMode !== 'PHOTO') throw new Error('PHOTO_REVISION_SCOPE_MISMATCH');
    const where = { ownerId: scope.ownerId, libraryMode: scope.libraryMode, assetId };
    await tx.eaglePhotoMetadata.deleteMany({ where });
    await tx.eaglePhotoFace.updateMany({ where, data: { isCurrent: false } });
    await tx.eaglePhotoGroup.updateMany({
      where: {
        ownerId: scope.ownerId,
        libraryMode: scope.libraryMode,
        kind: { not: 'MANUAL' },
        members: { some: { assetId } },
      },
      data: { dismissed: true },
    });
  }
}
