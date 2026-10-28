import {
  Prisma,
  type EagleAssetProcessingJob,
  type EagleObjectDeletion,
  type PrismaClient,
} from '@prisma/client';

export async function prepareAssetPurge(
  tx: Prisma.TransactionClient,
  job: EagleAssetProcessingJob,
): Promise<void> {
  const held = await tx.eagleAssetProcessingJob.updateMany({
    where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
    data: { lockedAt: new Date() },
  });
  if (held.count !== 1) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "EagleAsset" WHERE id=${job.assetId} AND "ownerId"=${job.ownerId} AND "libraryMode"=${job.libraryMode}::"LibraryMode" FOR UPDATE`,
  );
  const where = {
    id: job.assetId,
    ownerId: job.ownerId,
    libraryMode: job.libraryMode,
    mediaRevision: job.assetRevision,
    deletedAt: { not: null },
    purgeAfter: { lte: new Date() },
  };
  const asset = await tx.eagleAsset.findFirst({
    where,
    include: {
      renditions: { select: { storageKey: true } },
      imagePyramids: { select: { storagePrefix: true } },
    },
  });
  if (!asset) {
    await tx.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null },
    });
    return;
  }
  const objectKeys = [
    ...new Set([asset.originalObjectKey, ...asset.renditions.map((r) => r.storageKey)]),
  ];
  const prefixes = asset.imagePyramids.map((p) => `${p.storagePrefix}/`);
  for (const key of [...objectKeys, ...prefixes]) assertDeletionKey(asset.ownerId, key);
  await tx.eagleObjectDeletion.create({
    data: { ownerId: asset.ownerId, libraryMode: asset.libraryMode, objectKeys, prefixes },
  });
  await tx.uploadSession.updateMany({
    where: { uploaderId: asset.ownerId, libraryMode: asset.libraryMode, eagleAssetId: asset.id },
    data: { eagleAssetId: null },
  });
  const scope = { ownerId: asset.ownerId, libraryMode: asset.libraryMode };
  await tx.eagleUploadSessionState.updateMany({
    where: { ...scope, assetId: asset.id },
    data: { assetId: null },
  });
  await tx.eagleUploadSessionState.updateMany({
    where: { ...scope, replacementAssetId: asset.id },
    data: { replacementAssetId: null },
  });
  await tx.eagleBrowserCapture.updateMany({
    where: { ...scope, assetId: asset.id },
    data: { assetId: null },
  });
  const removed = await tx.eagleAsset.deleteMany({ where });
  if (removed.count !== 1) throw new Error('PURGE_STATE_CHANGED');
}

export function assertDeletionKey(ownerId: string, key: string): void {
  if (
    !key.startsWith(`users/${ownerId}/`) ||
    key.includes('..') ||
    key.includes('\\') ||
    key.includes('\0')
  )
    throw new Error('UNSAFE_OBJECT_DELETION');
}

/** Four receipts run concurrently; each receipt retains its own lease and retry result. */
export async function drainObjectDeletion(
  prisma: PrismaClient,
  storage: {
    deleteObjects: (keys: string[]) => Promise<void>;
    deletePrefix: (ownerId: string, prefix: string) => Promise<void>;
  },
): Promise<number> {
  const claims = await prisma.$queryRaw<EagleObjectDeletion[]>(Prisma.sql`
    WITH candidates AS (
      SELECT id FROM "EagleObjectDeletion"
      WHERE (status='PENDING' AND "availableAt"<=now())
         OR (status='PROCESSING' AND "lockedAt"<now()-interval '10 minutes')
      ORDER BY "createdAt",id LIMIT 4 FOR UPDATE SKIP LOCKED
    )
    UPDATE "EagleObjectDeletion" d
    SET status='PROCESSING',attempts=d.attempts+1,"leaseVersion"=d."leaseVersion"+1,
        "lockedAt"=now(),"updatedAt"=now()
    FROM candidates c WHERE d.id=c.id RETURNING d.*`);
  const results = await Promise.allSettled(
    claims.map(async (claim) => {
      const where = { id: claim.id, status: 'PROCESSING', leaseVersion: claim.leaseVersion };
      try {
        // Validate the entire receipt before any destructive request. Never mix
        // owners in a bulk request, and retain failed receipts for idempotent retry.
        for (const key of [...claim.objectKeys, ...claim.prefixes])
          assertDeletionKey(claim.ownerId, key);
        const keys = [...new Set(claim.objectKeys)];
        for (let offset = 0; offset < keys.length; offset += 1000)
          await storage.deleteObjects(keys.slice(offset, offset + 1000));
        for (const prefix of claim.prefixes) await storage.deletePrefix(claim.ownerId, prefix);
        await prisma.eagleObjectDeletion.deleteMany({ where });
      } catch {
        await prisma.eagleObjectDeletion.updateMany({
          where,
          data: {
            status: 'PENDING',
            lockedAt: null,
            availableAt: new Date(
              Date.now() + Math.min(3600, 2 ** Math.min(12, claim.attempts)) * 1000,
            ),
            lastError: 'OBJECT_DELETION_RETRY',
          },
        });
      }
    }),
  );
  // A database settlement failure must not let the caller release its cleanup
  // capacity while other destructive requests are still in flight.
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return claims.length;
}

export async function nextObjectDeletionWakeAt(prisma: PrismaClient): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<Array<{ nextAt: Date | null }>>(Prisma.sql`
    SELECT min(due) AS "nextAt" FROM (
      SELECT min("availableAt") AS due FROM "EagleObjectDeletion" WHERE status='PENDING'
      UNION ALL
      SELECT min("lockedAt")+interval '10 minutes' AS due FROM "EagleObjectDeletion" WHERE status='PROCESSING'
    ) deadlines`);
  return row?.nextAt ?? null;
}
