import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from './eagle-privacy.service';

// Saved recommendations contain the immutable snapshot distance. Human review
// publishes that evidence; it never calls a model or regenerates embeddings.
export async function reviewSavedSuggestions(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  suggestionIds: string[],
  action: 'ACCEPT' | 'REJECT',
  includePrivate: boolean,
) {
  if (action === 'ACCEPT') await lockOwnerPrivacyProjection(transaction, ownerId, libraryMode);
  const where = {
    ownerId,
    libraryMode,
    id: { in: suggestionIds },
    asset: {
      deletedAt: null,
      storageTransferredOut: false,
      ...(includePrivate ? {} : { isPrivate: false }),
    },
  };
  const suggestions = await transaction.eagleVectorTagSuggestion.findMany({
    where,
    include: {
      asset: { select: { mediaRevision: true, _count: { select: { manualTagLinks: true } } } },
      embedding: { select: { isCurrent: true, status: true, assetRevision: true } },
      snapshot: { select: { isCurrent: true, status: true } },
      suggestedTag: {
        select: {
          semanticConfig: { select: { recommendationEnabled: true, currentSnapshotId: true } },
        },
      },
    },
  });
  if (suggestions.length !== suggestionIds.length)
    throw new NotFoundException('待审核建议不存在。');
  const status = action === 'ACCEPT' ? ('ACCEPTED' as const) : ('REJECTED' as const);
  const pending = suggestions.filter((s) => s.status !== status);
  if (pending.some((s) => s.status !== 'PENDING' || !s.isActive || s.invalidatedAt))
    throw new ConflictException('建议已被处理或已失效，请刷新。');
  if (
    action === 'ACCEPT' &&
    pending.some(
      (s) =>
        s.asset._count.manualTagLinks !== 0 ||
        !s.embedding.isCurrent ||
        s.embedding.status !== 'READY' ||
        s.embedding.assetRevision !== s.asset.mediaRevision ||
        !s.snapshot.isCurrent ||
        s.snapshot.status !== 'ACTIVE' ||
        !s.suggestedTag.semanticConfig?.recommendationEnabled ||
        s.suggestedTag.semanticConfig.currentSnapshotId !== s.snapshotId,
    )
  )
    throw new ConflictException('图片或标签状态已变化，请刷新。');
  if (new Set(pending.map((s) => s.assetId)).size !== pending.length && action === 'ACCEPT')
    throw new ConflictException('同一图片只能确认一个推荐标签。');

  let privacyChanged = false;
  if (pending.length) {
    const updated = await transaction.eagleVectorTagSuggestion.updateMany({
      where: {
        ...where,
        id: { in: pending.map((s) => s.id) },
        status: 'PENDING',
        isActive: true,
        invalidatedAt: null,
      },
      data: { status, reviewedAt: new Date(), reviewedByUserId: ownerId },
    });
    if (updated.count !== pending.length) throw new ConflictException('建议已被处理，请刷新。');
    if (action === 'ACCEPT') {
      await transaction.eagleAssetManualTag.createMany({
        data: pending.map((s) => ({
          ownerId,
          libraryMode,
          assetId: s.assetId,
          tagId: s.suggestedTagId,
          assignedByUser: true,
          assignmentProvenance: 'VECTOR_SUGGESTED_HUMAN_ACCEPTED',
          acceptedSuggestionId: s.id,
        })),
      });
      await transaction.eagleManualTag.updateMany({
        where: {
          ownerId,
          libraryMode,
          id: { in: [...new Set(pending.map((s) => s.suggestedTagId))] },
        },
        data: { lastUsedAt: new Date() },
      });
      await transaction.eagleTagMemberDistance.createMany({
        data: pending.map((s) => ({
          ownerId,
          libraryMode,
          assetId: s.assetId,
          tagId: s.suggestedTagId,
          snapshotId: s.snapshotId,
          distance: s.distance,
          prototypeRank: s.prototypeRank,
        })),
        skipDuplicates: true,
      });
      privacyChanged =
        (await syncAssetPrivacy(
          transaction,
          ownerId,
          pending.map((s) => s.assetId),
          libraryMode,
        )) > 0;
    }
  }
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  return {
    items: suggestionIds.map((id) => ({
      id,
      status,
      assetId: byId.get(id)!.assetId,
      privacyChanged,
    })),
  };
}
