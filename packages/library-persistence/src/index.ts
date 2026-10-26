import { lockOwnerPrivacyProjection } from './privacy-lock';
export { lockOwnerPrivacyProjection } from './privacy-lock';
import { inheritedPrivacyTag } from './privacy-tag';
export { inheritedPrivacyTag } from './privacy-tag';
export * from './media-job-plan';
export { editedCopyTag, inheritEditedCopyDetails } from './edited-copy';
export { inheritPhotoEditedCopy } from './photo-edited-copy';
import { Prisma, type LibraryMode } from '@prisma/client';
export { backgroundScheduleSql } from './background-schedule';
export { taskPolicyAllowsSql, taskPrioritySql, mediaTaskFamilySql } from './task-policy';

export async function syncAssetPrivacy(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  assetIds?: string[],
  libraryMode: LibraryMode = 'MATERIAL',
): Promise<number> {
  await lockOwnerPrivacyProjection(transaction, ownerId, libraryMode);
  if (libraryMode === 'PHOTO') {
    if (assetIds?.length === 0) return 0;
    // Include both components before calculating the union, including when only the video changed.
    const scope = assetIds
      ? Prisma.sql`AND (a.id IN (${Prisma.join(assetIds)}) OR
      (a."livePhotoIdentifier" IS NOT NULL AND a."livePhotoIdentifier" IN (
        SELECT "livePhotoIdentifier" FROM "EagleAsset" WHERE "ownerId" = ${ownerId}
          AND "libraryMode" = 'PHOTO' AND id IN (${Prisma.join(assetIds)}))))`
      : Prisma.empty;
    return transaction.$executeRaw(Prisma.sql`
      WITH reasons AS MATERIALIZED (
        SELECT a.id, a."livePhotoIdentifier", a."livePhotoRole",
          (EXISTS (SELECT 1 FROM "EagleAssetManualTag" l JOIN "EagleManualTag" t
            ON t.id = l."tagId" AND t."ownerId" = l."ownerId" AND t."libraryMode" = l."libraryMode"
            WHERE l."ownerId" = a."ownerId" AND l."libraryMode" = a."libraryMode"
              AND l."assetId" = a.id AND t."marksAssetsPrivate")
          OR EXISTS (SELECT 1 FROM "EaglePhotoFace" f JOIN "EaglePhotoPerson" p
            ON p.id = f."personId" AND p."ownerId" = f."ownerId" AND p."libraryMode" = f."libraryMode"
            WHERE f."ownerId" = a."ownerId" AND f."libraryMode" = a."libraryMode"
              AND f."assetId" = a.id AND f."assetRevision" = a."mediaRevision"
              AND f."isCurrent" AND p."marksAssetsPrivate")) AS private
        FROM "EagleAsset" a WHERE a."ownerId" = ${ownerId} AND a."libraryMode" = 'PHOTO' ${scope}
      ), private_assets AS MATERIALIZED (
        SELECT r.id FROM reasons r WHERE r.private OR (
          r."livePhotoRole" IN ('STILL','MOTION') AND r."livePhotoIdentifier" IN (
            SELECT pair."livePhotoIdentifier" FROM reasons pair
            WHERE pair.private AND pair."livePhotoIdentifier" IS NOT NULL AND pair."livePhotoRole" IN ('STILL','MOTION')
          )
        )
      )
      UPDATE "EagleAsset" a SET "isPrivate" = (a.id IN (SELECT id FROM private_assets)),
        "rowVersion" = a."rowVersion" + 1, "updatedAt" = NOW()
      WHERE a."ownerId" = ${ownerId} AND a."libraryMode" = 'PHOTO' ${scope}
        AND a."isPrivate" IS DISTINCT FROM (a.id IN (SELECT id FROM private_assets))
    `);
  }
  const assetScope = assetIds ? { id: { in: assetIds } } : {};
  const madePublic = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      libraryMode,
      ...assetScope,
      isPrivate: true,
      manualTagLinks: { none: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: false, rowVersion: { increment: 1 } },
  });
  const madePrivate = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      libraryMode,
      ...assetScope,
      isPrivate: false,
      manualTagLinks: { some: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: true, rowVersion: { increment: 1 } },
  });
  return madePublic.count + madePrivate.count;
}

interface ReplacementPrivacyAsset {
  id: string;
  isPrivate: boolean;
  livePhotoIdentifier: string | null;
  livePhotoRole: string | null;
  manualTagLinks: Array<{ tag: { marksAssetsPrivate: boolean } }>;
}
/** Caller holds privacy, then asset locks. Preserve the old pair before breaking its identity. */
export async function preserveReplacementPrivacy(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  current: ReplacementPrivacyAsset,
): Promise<string[]> {
  if (!current.isPrivate) return [];
  const targets =
    libraryMode === 'PHOTO' &&
    current.livePhotoIdentifier &&
    ['STILL', 'MOTION'].includes(current.livePhotoRole ?? '')
      ? await transaction.eagleAsset.findMany({
          where: {
            ownerId,
            libraryMode,
            livePhotoIdentifier: current.livePhotoIdentifier,
            livePhotoRole: { in: ['STILL', 'MOTION'] },
          },
          select: {
            id: true,
            manualTagLinks: { select: { tag: { select: { marksAssetsPrivate: true } } } },
          },
        })
      : [current];
  const missing = targets.filter(
    (asset) => !asset.manualTagLinks.some((link) => link.tag.marksAssetsPrivate),
  );
  if (missing.length) {
    const tagId = await inheritedPrivacyTag(transaction, ownerId, libraryMode);
    await transaction.eagleAssetManualTag.createMany({
      data: missing.map(({ id: assetId }) => ({ ownerId, libraryMode, assetId, tagId })),
      skipDuplicates: true,
    });
  }
  return targets.map(({ id }) => id);
}

export {
  scheduleSmartFolderSnapshot,
  matchSmartFoldersForEmbedding,
  smartFolderMatchWhere,
} from './smart-folder-semantics';

export {
  PHOTO_FACE_MODEL_VERSION,
  unscannedPhotoFacesSql,
  queuePhotoFaceScan,
} from './photo-face-scan';
