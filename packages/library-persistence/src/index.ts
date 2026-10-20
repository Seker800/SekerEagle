import { Prisma, type LibraryMode } from '@prisma/client';

export async function lockOwnerPrivacyProjection(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode = 'MATERIAL',
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`sekereagle:privacy:${ownerId}:${libraryMode}`}, 0)
    )::text AS "lockResult"
  `);
}

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
      ), projection AS (
        SELECT r.id, (r.private OR EXISTS (SELECT 1 FROM reasons pair
          WHERE r."livePhotoIdentifier" IS NOT NULL AND pair."livePhotoIdentifier" = r."livePhotoIdentifier"
            AND r."livePhotoRole" IN ('STILL','MOTION') AND pair."livePhotoRole" IN ('STILL','MOTION')
            AND pair.private)) AS private FROM reasons r
      )
      UPDATE "EagleAsset" a SET "isPrivate" = p.private, "rowVersion" = a."rowVersion" + 1, "updatedAt" = NOW()
      FROM projection p WHERE a.id = p.id AND a."ownerId" = ${ownerId}
        AND a."libraryMode" = 'PHOTO' AND a."isPrivate" IS DISTINCT FROM p.private
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

/** Explicit private label for derived/replaced content without copying biometric analysis. */
export async function inheritedPrivacyTag(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
) {
  for (let suffix = 0; suffix < 100; suffix++) {
    const name = suffix ? `继承私密 ${suffix + 1}` : '继承私密';
    const tag = await transaction.eagleManualTag.upsert({
      where: { ownerId_libraryMode_normalizedName: { ownerId, libraryMode, normalizedName: name } },
      update: {},
      create: { ownerId, libraryMode, name, normalizedName: name, marksAssetsPrivate: true },
    });
    if (tag.marksAssetsPrivate) return tag.id;
  }
  throw new Error('无法创建继承私密标签，请调整同名标签后重试。');
}
