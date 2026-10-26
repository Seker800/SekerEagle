import {
  mediaStaleBeforeSql,
  mediaTaskFactsSql,
  taskBackoffFactsSql,
  taskWaitReasonSql,
} from '@sekereagle/library-persistence';
import { Prisma, type LibraryMode } from '@prisma/client';

/** Aggregate live sources only. External import history has no heartbeat protocol and is not activity evidence. */
export function taskCenterQuery(
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
  scope: 'ACTIVE' | 'HISTORY' = 'ACTIVE',
) {
  return Prisma.sql`
    WITH facts AS (
      SELECT 'MEDIA' AS family, j.kind::text AS step, j."processorVersion" AS version,
        CASE WHEN j.status='COMPLETED' THEN 'COMPLETED' WHEN j.status='FAILED' THEN 'FAILED'
          WHEN j.status='PROCESSING' AND j."lockedAt">${mediaStaleBeforeSql()} THEN 'RUNNING'
          ELSE 'QUEUED' END AS status,
        ${taskWaitReasonSql(mediaTaskFactsSql(Prisma.sql`j`, Prisma.sql`d`))} AS reason,
        j."availableAt" AS "nextAt", j."updatedAt" AS "lastActivityAt"
      FROM "EagleMediaJob" j JOIN "EagleAsset" a ON a.id=j."assetId" AND a."ownerId"=j."ownerId" AND a."libraryMode"=j."libraryMode"
      LEFT JOIN "EagleMediaJob" d ON j.status<>'COMPLETED' AND d.id=j."dependsOnJobId" AND d."ownerId"=j."ownerId" AND d."libraryMode"=j."libraryMode"
      WHERE j.kind<>'GENERATE_AI_TAGS' AND j."ownerId"=${ownerId} AND j."libraryMode"=${libraryMode}::"LibraryMode"
        ${scope === 'HISTORY' ? Prisma.sql`AND j.status='COMPLETED'` : Prisma.sql`AND j.status<>'COMPLETED'`}
        AND j."assetRevision"=a."mediaRevision" AND (${includePrivate} OR NOT a."isPrivate")
        AND (a."deletedAt" IS NULL OR j.kind='PURGE_ASSET')
      UNION ALL
      SELECT 'SMART_FOLDERS',CASE WHEN s."queryVector" IS NULL THEN 'SMART_FOLDER_QUERY' ELSE 'SMART_FOLDERS' END,'',
        CASE WHEN s.status='READY' THEN 'COMPLETED' WHEN s.status='FAILED' THEN 'FAILED'
          WHEN s."lockedUntil">now() THEN 'RUNNING' ELSE 'QUEUED' END,
        ${taskWaitReasonSql(taskBackoffFactsSql(Prisma.sql`s."availableAt"`, Prisma.sql`s."errorCode"`))},s."availableAt",s."updatedAt"
      FROM "EagleSmartFolderSemanticSnapshot" s
      WHERE s."ownerId"=${ownerId} AND s."libraryMode"=${libraryMode}::"LibraryMode"
        ${scope === 'HISTORY' ? Prisma.sql`AND s.status='READY'` : Prisma.sql`AND s.status IN ('PENDING','BUILDING','FAILED')`}
      UNION ALL
      SELECT 'TAG_INDEX','TAG_INDEX','',
        CASE WHEN b.status='COMPLETED' THEN 'COMPLETED' WHEN b.status='FAILED' THEN 'FAILED'
          WHEN b.status='PROCESSING' AND b."lockedAt">${mediaStaleBeforeSql()} THEN 'RUNNING' ELSE 'QUEUED' END,
        ${taskWaitReasonSql(taskBackoffFactsSql(Prisma.sql`b."availableAt"`, Prisma.sql`b."lastError"`))},b."availableAt",b."updatedAt"
      FROM "EagleTagSemanticBuild" b JOIN "EagleManualTag" t ON t.id=b."tagId" AND t."ownerId"=b."ownerId" AND t."libraryMode"=b."libraryMode"
      WHERE b."ownerId"=${ownerId} AND b."libraryMode"=${libraryMode}::"LibraryMode" AND (${includePrivate} OR NOT t."marksAssetsPrivate")
        ${scope === 'HISTORY' ? Prisma.sql`AND b.status='COMPLETED'` : Prisma.sql`AND b.status<>'COMPLETED'`}
      UNION ALL
      SELECT 'PHOTO_MAP','PHOTO_MAP','',
        CASE WHEN "dirtyAt" IS NULL THEN 'COMPLETED' WHEN "lockedUntil">now() THEN 'RUNNING' ELSE 'QUEUED' END,
        ${taskWaitReasonSql({ retryPending: Prisma.sql`"availableAt">now() AND "lastError" IS NOT NULL` })},"availableAt","dirtyAt"
      FROM "EaglePhotoMapState" WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode"
        ${scope === 'HISTORY' ? Prisma.sql`AND "dirtyAt" IS NULL` : Prisma.sql`AND "dirtyAt" IS NOT NULL`}
      UNION ALL
      SELECT 'CLEANUP','OBJECT_DELETION','',CASE WHEN status='PROCESSING' AND "lockedAt">${mediaStaleBeforeSql()} THEN 'RUNNING' ELSE 'QUEUED' END,
        ${taskWaitReasonSql(taskBackoffFactsSql(Prisma.sql`"availableAt"`))},"availableAt","updatedAt"
      FROM "EagleObjectDeletion" WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" AND ${includePrivate} AND ${scope === 'ACTIVE'}
      UNION ALL
      SELECT 'APPROVALS','APPROVALS','',CASE WHEN s.status='PENDING' THEN 'APPROVAL' WHEN s.status='FAILED' THEN 'FAILED'
        WHEN s.status='APPLYING' THEN 'RUNNING' ELSE 'COMPLETED' END,'APPROVAL',NULL::timestamptz,COALESCE(s."reviewedAt",s."createdAt")
      FROM "EaglePhotoAgentSuggestion" s JOIN "EagleAsset" a ON a.id=s."assetId" AND a."ownerId"=s."ownerId" AND a."libraryMode"=s."libraryMode"
      JOIN "EaglePhotoAgentTask" t ON t.id=s."taskId" AND t."ownerId"=s."ownerId" AND t."libraryMode"=s."libraryMode"
      WHERE s."ownerId"=${ownerId} AND s."libraryMode"=${libraryMode}::"LibraryMode" AND s."assetRevision"=a."mediaRevision"
        AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
        AND (t."expiresAt" IS NULL OR t."expiresAt">now()) AND t.status='OPEN'
        ${scope === 'HISTORY' ? Prisma.sql`AND s.status IN ('ACCEPTED','REJECTED')` : Prisma.sql`AND s.status IN ('PENDING','APPLYING','FAILED')`}
      UNION ALL
      SELECT 'UPLOADS','UPLOADS','',CASE WHEN j.status='PROCESSING' AND j."lockedAt">${mediaStaleBeforeSql()} THEN 'RUNNING'
        WHEN j.status='FAILED' THEN 'FAILED' WHEN j.status='COMPLETED' THEN 'COMPLETED' ELSE 'QUEUED' END,
        ${taskWaitReasonSql(taskBackoffFactsSql(Prisma.sql`j."availableAt"`))},j."availableAt",j."updatedAt"
      FROM "UploadFinalizationJob" j JOIN "UploadSession" s ON s.id=j."uploadSessionId"
      LEFT JOIN "EagleAsset" a ON a.id=s."eagleAssetId" AND a."ownerId"=s."uploaderId" AND a."libraryMode"=s."libraryMode"
      WHERE s."uploaderId"=${ownerId} AND s."libraryMode"=${libraryMode}::"LibraryMode"
        AND (${includePrivate} OR a.id IS NULL OR NOT a."isPrivate")
        ${scope === 'HISTORY' ? Prisma.sql`AND j.status='COMPLETED'` : Prisma.sql`AND j.status<>'COMPLETED'`}

    )
    SELECT family,step,version,status,reason,count(*) AS count,min("nextAt") AS "nextAt",max("lastActivityAt") AS "lastActivityAt"
    FROM facts GROUP BY family,step,version,status,reason ORDER BY family,step,status,reason
  `;
}
