import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { suggestPhotoGroups } from '@sekereagle/library-core';

/** Incremental, bounded grouping runs under the same owner lock as user corrections. */
export async function groupAnalyzedPhoto(
  tx: Prisma.TransactionClient,
  ownerId: string,
  assetId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
  const current = await tx.eaglePhotoMetadata.findFirst({
    where: { ownerId, libraryMode: 'PHOTO', assetId },
    include: { asset: { select: { isPrivate: true } } },
  });
  if (!current?.capturedAt || !current.perceptualHash) return;
  const rows = await tx.eaglePhotoMetadata.findMany({
    where: {
      ownerId,
      libraryMode: 'PHOTO',
      cameraModel: current.cameraModel,
      capturedAt: {
        gte: new Date(current.capturedAt.getTime() - 600000),
        lte: new Date(current.capturedAt.getTime() + 600000),
      },
      asset: { deletedAt: null, isPrivate: current.asset.isPrivate },
    },
    orderBy: [{ capturedAt: 'asc' }, { assetId: 'asc' }],
    take: 500,
  });
  for (const suggestion of suggestPhotoGroups(rows.map((row) => ({ ...row, id: row.assetId })))) {
    if (!suggestion.assetIds.includes(assetId)) continue;
    const groups = await tx.eaglePhotoGroup.findMany({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        members: { some: { assetId: { in: suggestion.assetIds } } },
      },
      include: { members: { select: { assetId: true } } },
    });
    // Dismissed suggestions and manual membership are durable user decisions.
    if (groups.some((group) => group.dismissed || group.kind === 'MANUAL') || groups.length > 1)
      continue;
    const existing = groups[0];
    if (existing) {
      if (existing.members.some(({ assetId: id }) => !suggestion.assetIds.includes(id))) continue;
      const memberIds = [
        ...new Set([...existing.members.map((row) => row.assetId), ...suggestion.assetIds]),
      ];
      if (memberIds.length === existing.members.length) continue;
      await tx.eaglePhotoGroupMember.createMany({
        data: memberIds.map((id) => ({
          ownerId,
          libraryMode: 'PHOTO' as const,
          groupId: existing.id,
          assetId: id,
        })),
        skipDuplicates: true,
      });
      if (!existing.bestSelectedByUser)
        await tx.eaglePhotoGroup.updateMany({
          where: { ownerId, libraryMode: 'PHOTO', id: existing.id },
          data: { bestAssetId: suggestion.bestAssetId },
        });
    } else {
      const sourceKey =
        'auto-v1:' +
        createHash('sha256')
          .update(
            [...suggestion.assetIds]
              .sort()
              .map((id) => `${id}:${rows.find((row) => row.assetId === id)?.assetRevision ?? 0}`)
              .join(':'),
          )
          .digest('hex');
      const group = await tx.eaglePhotoGroup.create({
        data: {
          ownerId,
          libraryMode: 'PHOTO',
          sourceKey,
          kind: suggestion.kind,
          bestAssetId: suggestion.bestAssetId,
        },
      });
      await tx.eaglePhotoGroupMember.createMany({
        data: suggestion.assetIds.map((id) => ({
          ownerId,
          libraryMode: 'PHOTO' as const,
          groupId: group.id,
          assetId: id,
        })),
      });
    }
  }
}
