import { Prisma, type EagleAssetProcessingJob, type PrismaClient } from '@prisma/client';

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

export async function drainObjectDeletion(
  prisma: PrismaClient,
  storage: {
    deleteObject: (key: string) => Promise<void>;
    deletePrefix: (ownerId: string, prefix: string) => Promise<void>;
  },
): Promise<void> {
  const claim = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "EagleObjectDeletion"
      WHERE (status='PENDING' AND "availableAt"<=now())
         OR (status='PROCESSING' AND "lockedAt"<now()-interval '10 minutes')
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!rows[0]) return null;
    return tx.eagleObjectDeletion.update({
      where: { id: rows[0].id },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        leaseVersion: { increment: 1 },
        lockedAt: new Date(),
      },
    });
  });
  if (!claim) return;
  const where = { id: claim.id, status: 'PROCESSING', leaseVersion: claim.leaseVersion };
  try {
    for (const key of claim.objectKeys) {
      assertDeletionKey(claim.ownerId, key);
      await storage.deleteObject(key);
    }
    for (const prefix of claim.prefixes) {
      assertDeletionKey(claim.ownerId, prefix);
      await storage.deletePrefix(claim.ownerId, prefix);
    }
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
}
