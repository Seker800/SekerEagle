import { Prisma, type PrismaClient } from '@prisma/client';
import { validatePhotoMaintenanceManifest, type RefreshItem } from './photo-maintenance-scope';
export type SourceTimelineItem = RefreshItem & { sourceDate: string; dateSource: string };
const sources = new Set(['DateTimeOriginal','CreateDate','MediaCreateDate','TrackCreateDate','FileModifyTime']);
/** One atomic bounded batch; existing capture metadata and edited inheritance remain authoritative. */
export async function refreshSourceTimeline(client: Pick<PrismaClient, '$queryRaw'>, ownerId: string, items: SourceTimelineItem[]): Promise<Array<{id:string}>> {
  validatePhotoMaintenanceManifest(items.map(({assetId,sha256,mediaRevision})=>({assetId,sha256,mediaRevision})));
  if (!ownerId || items.some(x => !sources.has(x.dateSource) || !Number.isFinite(Date.parse(x.sourceDate)) || new Date(x.sourceDate).getUTCFullYear()<1900 || new Date(x.sourceDate).getUTCFullYear()>2200)) throw new Error('INVALID_SOURCE_DATE');
  const evidence = JSON.stringify(items.map(x=>({...x,sourceDate:new Date(x.sourceDate).toISOString()})));
  return client.$queryRaw<Array<{id:string}>>(Prisma.sql`
    UPDATE "EagleAsset" a
    SET "chronologicalAt"=COALESCE(m."capturedAt",i."sourceDate"::timestamp),
      "rowVersion"=a."rowVersion"+1,"updatedAt"=NOW()
    FROM jsonb_to_recordset(${evidence}::jsonb) AS i("assetId" text,"sha256" text,"mediaRevision" int,"sourceDate" text)
    LEFT JOIN "EaglePhotoMetadata" m ON m."assetId"=i."assetId" AND m."ownerId"=${ownerId}
      AND m."libraryMode"='PHOTO' AND m."assetRevision"=i."mediaRevision"
    WHERE a.id=i."assetId" AND a."ownerId"=${ownerId} AND a."libraryMode"='PHOTO'
      AND a."sha256"=i."sha256" AND a."mediaRevision"=i."mediaRevision" AND a."deletedAt" IS NULL
      AND COALESCE(m."captureMetadataInherited",false)=false
      AND a."chronologicalAt" IS DISTINCT FROM COALESCE(m."capturedAt",i."sourceDate"::timestamp)
    RETURNING a.id
  `);
}
