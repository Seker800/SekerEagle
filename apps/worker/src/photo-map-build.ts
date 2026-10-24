import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type EaglePhotoMapState } from '@prisma/client';

const MAX_LEVEL = 21;
const LEVELS_PER_STEP = 4;

/** Called between media jobs at most every 15 seconds; pending ingestion never starves map work.
 * One owner, one fenced step. Upload/metadata writes merely coalesce the dirty marker. */
export async function runPhotoMapBuildStep(client: PrismaClient) {
  const token = randomUUID();
  const [claim] = await client.$queryRaw<EaglePhotoMapState[]>(Prisma.sql`
    UPDATE "EaglePhotoMapState" SET "leaseToken"=${token},"lockedUntil"=now()+interval '2 minutes'
    WHERE ("ownerId","libraryMode")=(
      SELECT s."ownerId",s."libraryMode" FROM "EaglePhotoMapState" s
      WHERE s."dirtyAt" IS NOT NULL AND (s."lockedUntil" IS NULL OR s."lockedUntil"<now())
        AND (s."availableAt"<=now() OR (s."buildingSnapshotId" IS NOT NULL AND s."lastError" IS NULL))
        AND NOT EXISTS (SELECT 1 FROM "EagleMediaJob" j
          WHERE j."ownerId"=s."ownerId" AND j."libraryMode"='PHOTO'
          AND j.status='PROCESSING' AND j."lockedAt">now()-interval '10 minutes')
      ORDER BY s."availableAt",s."ownerId" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *
  `);
  if (!claim) return false;
  try {
    if (!claim.buildingSnapshotId) {
      await client.$transaction(
        async (tx) => {
          const state = await tx.eaglePhotoMapState.findUniqueOrThrow({
            where: { ownerId_libraryMode: { ownerId: claim.ownerId, libraryMode: 'PHOTO' } },
          });
          if (state.leaseToken !== token) throw new Error('MAP_LEASE_LOST');
          const snapshot = await tx.eaglePhotoMapSnapshot.create({
            data: {
              ownerId: state.ownerId,
              version: state.requestedVersion,
              visibilityVersion: state.visibilityVersion,
              summary: {},
            },
          });
          // Freeze coordinates once. Raw EXIF wins; accepted supplemental location is the fallback.
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "EaglePhotoMapPoint"("ownerId","libraryMode","snapshotId","assetId","assetRevision","isPrivate","chronologicalAt",latitude,longitude,x,y)
          WITH coordinates AS (
            SELECT a.id,a."mediaRevision",a."isPrivate",a."chronologicalAt",
              CASE WHEN m.latitude BETWEEN -90 AND 90 AND m.longitude BETWEEN -180 AND 180 THEN m.latitude ELSE l.latitude END AS latitude,
              CASE WHEN m.latitude BETWEEN -90 AND 90 AND m.longitude BETWEEN -180 AND 180 THEN m.longitude ELSE l.longitude END AS longitude
            FROM "EagleAsset" a
            LEFT JOIN "EaglePhotoMetadata" m ON m."ownerId"=a."ownerId" AND m."libraryMode"=a."libraryMode" AND m."assetId"=a.id AND m."assetRevision"=a."mediaRevision"
            LEFT JOIN "EaglePhotoLocation" l ON l."ownerId"=a."ownerId" AND l."libraryMode"=a."libraryMode" AND l."assetId"=a.id AND l."assetRevision"=a."mediaRevision"
            WHERE a."ownerId"=${state.ownerId} AND a."libraryMode"='PHOTO' AND a."deletedAt" IS NULL AND a."mimeType" LIKE 'image/%'
          )
          SELECT ${state.ownerId},'PHOTO'::"LibraryMode",${snapshot.id},id,"mediaRevision","isPrivate","chronologicalAt",latitude,longitude,
            LEAST(2097151,GREATEST(0,FLOOR((longitude+180)/360*2097152)))::int,
            LEAST(2097151,GREATEST(0,FLOOR((1-LN(TAN(PI()/4+RADIANS(LEAST(85.05112878,GREATEST(-85.05112878,latitude)))/2))/PI())/2*2097152)))::int
          FROM coordinates WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        `);
          const summaries = await tx.$queryRaw<
            Array<{
              includePrivate: boolean;
              total: number;
              south: number | null;
              north: number | null;
              west: number | null;
              east: number | null;
            }>
          >(Prisma.sql`
          SELECT v.flag AS "includePrivate",count(p."assetId")::int AS total,MIN(p.latitude) AS south,MAX(p.latitude) AS north,MIN(p.longitude) AS west,MAX(p.longitude) AS east
          FROM (VALUES(false),(true)) v(flag) LEFT JOIN "EaglePhotoMapPoint" p ON p."ownerId"=${state.ownerId} AND p."libraryMode"='PHOTO' AND p."snapshotId"=${snapshot.id} AND (v.flag OR NOT p."isPrivate")
          GROUP BY v.flag
        `);
          await tx.eaglePhotoMapSnapshot.update({
            where: { id: snapshot.id },
            data: { summary: JSON.parse(JSON.stringify(summaries)) as Prisma.InputJsonValue },
          });
          const published = await tx.eaglePhotoMapState.updateMany({
            where: {
              ownerId: state.ownerId,
              libraryMode: 'PHOTO',
              leaseToken: token,
              lockedUntil: { gt: new Date() },
            },
            data: {
              buildingSnapshotId: snapshot.id,
              nextLevel: 0,
              leaseToken: null,
              lockedUntil: null,
              lastError: null,
            },
          });
          if (!published.count) throw new Error('MAP_LEASE_LOST');
        },
        { isolationLevel: 'RepeatableRead', timeout: 60000 },
      );
      return true;
    }
    await client.$transaction(
      async (tx) => {
        const held = await tx.eaglePhotoMapState.updateMany({
          where: {
            ownerId: claim.ownerId,
            libraryMode: 'PHOTO',
            leaseToken: token,
            lockedUntil: { gt: new Date() },
          },
          data: { lockedUntil: new Date(Date.now() + 120000) },
        });
        if (!held.count) throw new Error('MAP_LEASE_LOST');
        const state = await tx.eaglePhotoMapState.findUniqueOrThrow({
          where: { ownerId_libraryMode: { ownerId: claim.ownerId, libraryMode: 'PHOTO' } },
        });
        const snapshot = await tx.eaglePhotoMapSnapshot.findUniqueOrThrow({
          where: { id: claim.buildingSnapshotId! },
        });
        if (snapshot.visibilityVersion !== state.visibilityVersion) {
          await tx.eaglePhotoMapState.update({
            where: { ownerId_libraryMode: { ownerId: claim.ownerId, libraryMode: 'PHOTO' } },
            data: { buildingSnapshotId: null, nextLevel: 0, leaseToken: null, lockedUntil: null },
          });
          await tx.eaglePhotoMapSnapshot.delete({ where: { id: snapshot.id } });
          return;
        }
        const end = Math.min(MAX_LEVEL + 1, state.nextLevel + LEVELS_PER_STEP);
        for (let level = state.nextLevel; level < end; level++) {
          const shift = MAX_LEVEL - level,
            n = 2 ** level;
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "EaglePhotoMapCell"("ownerId","libraryMode","snapshotId","includePrivate",level,x,y,count,latitude,longitude,south,north,west,east,"coverId","coverRevision")
          WITH projected AS (
            SELECT p.*,(p.x >> ${shift}::int) AS cx,(p.y >> ${shift}::int) AS cy,
              FLOOR(p.latitude*${n * 4}/180) AS sy,FLOOR(p.longitude*${n * 4}/360) AS sx
            FROM "EaglePhotoMapPoint" p WHERE p."ownerId"=${claim.ownerId} AND p."libraryMode"='PHOTO' AND p."snapshotId"=${snapshot.id}
          ), buckets AS (
            SELECT v.flag AS private,p.cx AS x,p.cy AS y,p.sx,p.sy,count(*) AS weight,
              (ARRAY_AGG(p.latitude ORDER BY p."chronologicalAt" DESC,p."assetId" DESC))[1] AS latitude,
              (ARRAY_AGG(p.longitude ORDER BY p."chronologicalAt" DESC,p."assetId" DESC))[1] AS longitude,
              (ARRAY_AGG(p."assetId" ORDER BY p."chronologicalAt" DESC,p."assetId" DESC))[1] AS "coverId",
              (ARRAY_AGG(p."assetRevision" ORDER BY p."chronologicalAt" DESC,p."assetId" DESC))[1] AS "coverRevision",
              MIN(p.latitude) AS south,MAX(p.latitude) AS north,MIN(p.longitude) AS west,MAX(p.longitude) AS east
            FROM projected p CROSS JOIN (VALUES(false),(true)) v(flag) WHERE v.flag OR NOT p."isPrivate"
            GROUP BY v.flag,p.cx,p.cy,p.sx,p.sy
          ), ranked AS (
            SELECT *,ROW_NUMBER() OVER(PARTITION BY private,x,y ORDER BY weight DESC,sx,sy) AS rank,
              SUM(weight) OVER(PARTITION BY private,x,y)::int AS total,
              MIN(south) OVER(PARTITION BY private,x,y) AS s,MAX(north) OVER(PARTITION BY private,x,y) AS n,
              MIN(west) OVER(PARTITION BY private,x,y) AS w,MAX(east) OVER(PARTITION BY private,x,y) AS e FROM buckets
          ) SELECT ${claim.ownerId},'PHOTO'::"LibraryMode",${snapshot.id},private,${level},x,y,total,latitude,longitude,s,n,w,e,"coverId","coverRevision" FROM ranked WHERE rank=1
        `);
        }
        const complete = end > MAX_LEVEL;
        await tx.eaglePhotoMapState.update({
          where: { ownerId_libraryMode: { ownerId: claim.ownerId, libraryMode: 'PHOTO' } },
          data: {
            leaseToken: null,
            lockedUntil: null,
            attempts: 0,
            lastError: null,
            nextLevel: end,
            ...(complete
              ? {
                  activeSnapshotId: snapshot.id,
                  buildingSnapshotId: null,
                  builtVersion: snapshot.version,
                  dirtyAt: state.requestedVersion === snapshot.version ? null : new Date(),
                  availableAt:
                    state.requestedVersion === snapshot.version
                      ? state.availableAt
                      : new Date(Date.now() + 60000),
                }
              : {}),
          },
        });
        if (complete) {
          await tx.eaglePhotoMapSnapshot.update({
            where: { id: snapshot.id },
            data: { completedAt: new Date() },
          });
          await tx.eaglePhotoMapSnapshot.deleteMany({
            where: {
              ownerId: claim.ownerId,
              libraryMode: 'PHOTO',
              id: {
                notIn: [snapshot.id, ...(state.activeSnapshotId ? [state.activeSnapshotId] : [])],
              },
            },
          });
        }
      },
      { timeout: 60000 },
    );
    return true;
  } catch (error) {
    await client.eaglePhotoMapState.updateMany({
      where: { ownerId: claim.ownerId, libraryMode: 'PHOTO', leaseToken: token },
      data: {
        leaseToken: null,
        lockedUntil: null,
        attempts: { increment: 1 },
        lastError: 'INDEX_BUILD_FAILED',
        availableAt: new Date(
          Date.now() + Math.min(900000, 30000 * 2 ** Math.min(claim.attempts, 5)),
        ),
      },
    });
    throw error;
  }
}
