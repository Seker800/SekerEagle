import { randomUUID } from 'node:crypto';
import { embeddingRetry } from './embedding-retry';
import { Prisma, type PrismaClient, type EagleSmartFolderSemanticSnapshot } from '@prisma/client';
import {
  scheduleSmartFolderSnapshot,
  backgroundScheduleSql,
  taskPolicyAllowsSql,
  taskPrioritySql,
} from '@sekereagle/library-persistence';
import { parseEagleFilterQuery, EAGLE_SEMANTIC_THRESHOLDS } from '@sekereagle/eagle-filter-core';

export function validateQueryVector(vector: readonly number[]) {
  const norm = vector.reduce((sum, value) => sum + value * value, 0);
  if (
    vector.length !== 1024 ||
    vector.some((value) => !Number.isFinite(value)) ||
    Math.abs(norm - 1) > 0.01
  )
    throw new Error('INVALID_QUERY_VECTOR');
}
export function smartFolderRetry(attempts: number, now = new Date()) {
  return {
    status: attempts >= 5 ? 'FAILED' : 'PENDING',
    availableAt: new Date(now.getTime() + Math.min(900, 30 * 2 ** (attempts - 1)) * 1000),
  };
}

/** Space changes enqueue new snapshots; an active old-space snapshot remains readable. */
export async function reconcileSmartFolderSpaces(client: PrismaClient, spaceId: string) {
  const folders = await client.$queryRaw<
    Array<{ id: string; ownerId: string; libraryMode: 'PHOTO' | 'MATERIAL' }>
  >(Prisma.sql`
    SELECT f.id, f."ownerId", f."libraryMode" FROM "EagleSmartFolder" f
    WHERE f."queryJson"->'semantic' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "EagleSmartFolderSemanticSnapshot" s WHERE s."folderId"=f.id
        AND s."ownerId"=f."ownerId" AND s."libraryMode"=f."libraryMode"
        AND s."spaceId"=${spaceId} AND s.text=f."queryJson"->'semantic'->>'text'
        AND s.breadth=f."queryJson"->'semantic'->>'breadth'
    ) ORDER BY f.id LIMIT 10
  `);
  for (const folder of folders)
    await client.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EagleSmartFolder" WHERE id=${folder.id}
      AND "ownerId"=${folder.ownerId} AND "libraryMode"=${folder.libraryMode}::"LibraryMode" FOR UPDATE`);
      const current = await tx.eagleSmartFolder.findFirst({
        where: { id: folder.id, ownerId: folder.ownerId, libraryMode: folder.libraryMode },
      });
      if (!current) return;
      const intent = parseEagleFilterQuery(current.queryJson).semantic;
      if (intent)
        await scheduleSmartFolderSnapshot(
          tx,
          { ownerId: folder.ownerId, libraryMode: folder.libraryMode },
          folder.id,
          intent,
          spaceId,
          EAGLE_SEMANTIC_THRESHOLDS[intent.breadth],
        );
    });
}

/** One bounded batch per call, with durable cursor and fencing token for crash recovery. */
export async function runSmartFolderBuildStep(
  client: PrismaClient,
  spaceId: string,
  embedText: (text: string) => Promise<{ embedding: number[] }>,
  allowModelRequest = true,
) {
  const token = randomUUID();
  const [build] = await client.$queryRaw<
    Array<EagleSmartFolderSemanticSnapshot & { hasVector: boolean }>
  >(Prisma.sql`
    UPDATE "EagleSmartFolderSemanticSnapshot" SET status='BUILDING', "leaseToken"=${token},
      "lockedUntil"=now()+interval '12 minutes', "updatedAt"=now()
    WHERE id=(SELECT id FROM "EagleSmartFolderSemanticSnapshot" s
      WHERE "spaceId"=${spaceId} AND status IN ('PENDING','BUILDING') AND "availableAt"<=now()
        AND ("lockedUntil" IS NULL OR "lockedUntil"<now())
        AND (${allowModelRequest} OR s."queryVector" IS NOT NULL)
        AND ${backgroundScheduleSql(Prisma.sql`s."ownerId"`, Prisma.sql`s."libraryMode"`)}
        AND ${taskPolicyAllowsSql(Prisma.sql`s."ownerId"`, Prisma.sql`s."libraryMode"`, Prisma.sql`'SMART_FOLDERS'`)}
      ORDER BY ${taskPrioritySql(Prisma.sql`s."ownerId"`, Prisma.sql`s."libraryMode"`, Prisma.sql`'SMART_FOLDERS'`)} DESC,"availableAt", "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, "ownerId", "libraryMode", "folderId", text, cursor, attempts, ("queryVector" IS NOT NULL) AS "hasVector"
  `);
  if (!build) return false;
  try {
    if (!build.hasVector) {
      const { embedding } = await embedText(build.text);
      validateQueryVector(embedding);
      const written = await client.$executeRaw(Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot"
        SET "queryVector"=${`[${embedding.join(',')}]`}::vector, "updatedAt"=now()
        WHERE id=${build.id} AND "leaseToken"=${token} AND "lockedUntil">now()`);
      if (!written) return true;
    }
    await client.$transaction(
      async (tx) => {
        // Same folder-first lock order as API writes, so obsolete builds cannot activate.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "EagleSmartFolder" WHERE id=${build.folderId}
        AND "ownerId"=${build.ownerId} AND "libraryMode"=${build.libraryMode}::"LibraryMode" FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "EagleSmartFolderSemanticSnapshot"
        WHERE "ownerId"=${build.ownerId} AND "libraryMode"=${build.libraryMode}::"LibraryMode" AND "folderId"=${build.folderId}
        ORDER BY id FOR NO KEY UPDATE`);
        const held = await tx.eagleSmartFolderSemanticSnapshot.updateMany({
          where: { id: build.id, leaseToken: token, lockedUntil: { gt: new Date() } },
          data: { updatedAt: new Date() },
        });
        if (!held.count) return;
        const rows = await tx.$queryRaw<Array<{ id: string; assetId: string }>>(Prisma.sql`
        SELECT e.id, e."assetId" FROM "EagleAssetEmbedding" e JOIN "EagleAsset" a
          ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode" AND a."mediaRevision"=e."assetRevision"
        WHERE e."ownerId"=${build.ownerId} AND e."libraryMode"=${build.libraryMode}::"LibraryMode"
          AND e."spaceId"=${spaceId} AND e."isCurrent" AND e.status='READY' AND e.embedding IS NOT NULL
          AND e."assetId">${build.cursor} ORDER BY e."assetId" LIMIT 500
      `);
        if (rows.length)
          await tx.$executeRaw(Prisma.sql`
        INSERT INTO "EagleSmartFolderSemanticMatch" ("ownerId", "libraryMode", "snapshotId", "embeddingId", similarity)
        SELECT e."ownerId", e."libraryMode", s.id, e.id, 1-(e.embedding <=> s."queryVector")
        FROM "EagleAssetEmbedding" e JOIN "EagleSmartFolderSemanticSnapshot" s
          ON s."ownerId"=e."ownerId" AND s."libraryMode"=e."libraryMode" AND s."spaceId"=e."spaceId"
        WHERE s.id=${build.id} AND s."leaseToken"=${token} AND e.id=ANY(${rows.map((row) => row.id)}::text[])
          AND e."isCurrent" AND e.status='READY' AND 1-(e.embedding <=> s."queryVector")>=s.threshold
        ON CONFLICT ("snapshotId", "embeddingId") DO UPDATE SET similarity=EXCLUDED.similarity
      `);
        let done = rows.length < 500;
        let waitingForSpace = false;
        if (done) {
          // Do not replace a usable old-space cache with an empty/partial migration.
          const [coverage] = await tx.$queryRaw<Array<{ missing: boolean }>>(Prisma.sql`
          SELECT EXISTS (SELECT 1 FROM "EagleSmartFolderSemanticSnapshot" old
            JOIN "EagleAssetEmbedding" e ON e."ownerId"=old."ownerId" AND e."libraryMode"=old."libraryMode" AND e."spaceId"=old."spaceId"
            JOIN "EagleAsset" a ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode" AND a."mediaRevision"=e."assetRevision"
            WHERE old."folderId"=${build.folderId} AND old."ownerId"=${build.ownerId} AND old."libraryMode"=${build.libraryMode}::"LibraryMode"
              AND old."isActive" AND old."spaceId"<>${spaceId} AND e.embedding IS NOT NULL AND a."deletedAt" IS NULL
              AND NOT EXISTS (SELECT 1 FROM "EagleAssetEmbedding" fresh WHERE fresh."assetId"=a.id
                AND fresh."ownerId"=a."ownerId" AND fresh."libraryMode"=a."libraryMode" AND fresh."assetRevision"=a."mediaRevision"
                AND fresh."spaceId"=${spaceId} AND fresh.status='READY' AND fresh."isCurrent" AND fresh.embedding IS NOT NULL)
          ) AS missing
        `);
          waitingForSpace = coverage?.missing ?? true;
          done = !waitingForSpace;
        }
        if (done) {
          await tx.eagleSmartFolderSemanticSnapshot.deleteMany({
            where: {
              ownerId: build.ownerId,
              libraryMode: build.libraryMode,
              folderId: build.folderId,
              id: { not: build.id },
            },
          });
        }
        // Queue eligibility is owned by the database clock, including immediate batches.
        await tx.$executeRaw(Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot"
          SET "availableAt"=clock_timestamp()+${waitingForSpace ? 30_000 : 0}*interval '1 millisecond'
          WHERE id=${build.id}`);
        await tx.eagleSmartFolderSemanticSnapshot.update({
          where: { id: build.id },
          data: {
            cursor: rows.at(-1)?.assetId ?? build.cursor,
            scannedCount: { increment: rows.length },
            status: done ? 'READY' : 'BUILDING',
            isActive: done,
            completedAt: done ? new Date() : null,
            lockedUntil: null,
            leaseToken: null,
            errorCode: null,
            attempts: 0,
          },
        });
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  } catch (error) {
    // Folder attempts increment on failure, whereas media/tag attempts increment at claim.
    const retry = embeddingRetry(error, build.attempts + 1);
    const attempts = retry ? retry.data.attempts : build.attempts + 1;
    await client.eagleSmartFolderSemanticSnapshot.updateMany({
      where: { id: build.id, leaseToken: token },
      data: {
        ...(retry
          ? { status: 'PENDING', availableAt: retry.data.availableAt }
          : smartFolderRetry(attempts)),
        attempts,
        lockedUntil: null,
        leaseToken: null,
        errorCode: retry ? retry.data.lastError : 'BUILD_UNAVAILABLE',
      },
    });
  }
  return true;
}
