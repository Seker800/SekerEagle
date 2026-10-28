import { Prisma, type PrismaClient } from '@prisma/client';
import { lockOwnerPrivacyProjection } from './privacy-lock';

import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
export { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';

/** One scope for coverage and enqueue. Failed/current jobs remain owned by retry, not scan. */
export function unscannedPhotoFacesSql(ownerId: string, includePrivate: boolean) {
  return Prisma.sql`
    SELECT a.id, a."ownerId", a."libraryMode", a."mediaRevision"
    FROM "EagleAsset" a
    WHERE a."ownerId"=${ownerId} AND a."libraryMode"='PHOTO'
      AND a."deletedAt" IS NULL AND a."lifecycleStatus"='READY'
      AND a."mimeType" LIKE 'image/%' AND (${includePrivate} OR NOT a."isPrivate")
      AND EXISTS (SELECT 1 FROM "EagleAssetRendition" r
        WHERE r."ownerId"=a."ownerId" AND r."libraryMode"=a."libraryMode"
          AND r."assetId"=a.id AND r.revision=a."mediaRevision"
          AND r.kind='PREVIEW' AND r.status='READY' AND r.variant='default')
      AND NOT EXISTS (SELECT 1 FROM "EagleMediaJob" j
        WHERE j."ownerId"=a."ownerId" AND j."libraryMode"=a."libraryMode"
          AND j."assetId"=a.id AND j."assetRevision"=a."mediaRevision"
          AND j.kind='ANALYZE_PHOTO_FACES' AND j."processorVersion"=${PHOTO_FACE_MODEL_VERSION})
  `;
}

/** Atomic set-based acceptance; the existing queue is the durable scan checkpoint. */
export async function queuePhotoFaceScan(
  db: Pick<PrismaClient, '$transaction'>,
  ownerId: string,
  includePrivate: boolean,
) {
  return db.$transaction(
    async (tx) => {
      // Admission writes the whole library atomically. Leave a bounded window for
      // NAS WAL flushes, with transaction and scan-route deadlines above it.
      await tx.$executeRaw`SET LOCAL statement_timeout = '600s'`;
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      const rows = await tx.$queryRaw<Array<{ queued: bigint }>>(Prisma.sql`
      WITH inserted AS (
        INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId",kind,status,lane,
          "assetRevision","processorVersion",attempts,"leaseVersion","availableAt","createdAt","updatedAt")
        SELECT gen_random_uuid()::text, a."ownerId", a."libraryMode", a.id,
          'ANALYZE_PHOTO_FACES','PENDING','BACKGROUND',a."mediaRevision",${PHOTO_FACE_MODEL_VERSION},0,0,now(),now(),now()
        FROM (${unscannedPhotoFacesSql(ownerId, includePrivate)}) a
        ON CONFLICT ("assetId",kind,"assetRevision","processorVersion") DO NOTHING
        RETURNING id
      ) SELECT count(*) AS queued FROM inserted
    `);
      const queued = Number(rows[0]?.queued ?? 0);
      return { queued, scanned: queued, limit: null };
    },
    { maxWait: 5000, timeout: 630000 },
  );
}
