import type { Readable } from 'node:stream';
import { Prisma, type LibraryMode } from '@prisma/client';
import { DUPLICATE_PIXEL_VERSION } from '@sekereagle/library-core';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { inDuplicateLibrary, type Item, type ScanSnapshot } from './eagle-duplicate-model';
import { completeDuplicateItem } from './eagle-duplicate-item';
import {
  verifyDuplicateOriginal,
  withDuplicateOriginalSlot,
  type OriginalProof,
} from './eagle-duplicate-original';

/** Compatibility executor for original-verification items already queued by older releases. */
export async function executeDuplicateVerification(
  prisma: PrismaService,
  storage: ObjectStorageService,
  mode: LibraryMode,
  item: Item,
  assertActor: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const snapshot = item.snapshots as unknown as Extract<ScanSnapshot, { rows: unknown }>;
  const results: Array<{ id: string; mediaRevision: number; proof: OriginalProof }> = [];
  const rows = await prisma.eagleAsset.findMany({
    where: {
      ...inDuplicateLibrary(item.ownerId, mode, item.operation.isPrivate),
      id: { in: item.assetIds },
    },
    select: {
      id: true,
      mediaRevision: true,
      originalObjectKey: true,
      sha256: true,
      format: true,
      livePhotoIdentifier: true,
      editRecipe: { select: { baseAssetId: true } },
    },
  });
  for (const row of rows) {
    if (snapshot.rows.find((r) => r.id === row.id)?.mediaRevision !== row.mediaRevision) continue;
    let proof: OriginalProof = { hash: null, status: 'UNSUPPORTED' };
    if (
      ['jpeg', 'jpg', 'jpe', 'png'].includes(row.format.toLowerCase()) &&
      !row.livePhotoIdentifier &&
      !row.editRecipe?.baseAssetId &&
      row.sha256
    ) {
      proof = await withDuplicateOriginalSlot(async () => {
        const timeout = Number(process.env.EAGLE_DUPLICATE_ORIGINAL_TIMEOUT_MS ?? 120_000);
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 4_294_967_295)
          throw new Error('INVALID_DUPLICATE_ORIGINAL_BUDGET');
        const signal = AbortSignal.timeout(timeout);
        const response = await storage.getObject(row.originalObjectKey, { abortSignal: signal });
        return verifyDuplicateOriginal(response.Body as Readable, row.sha256!, { signal });
      });
    }
    results.push({ id: row.id, mediaRevision: row.mediaRevision, proof });
  }
  await prisma.$transaction(async (tx) => {
    await assertActor(tx);
    if (results.length)
      await tx.$executeRaw`
      UPDATE "EagleDuplicateFingerprint" f SET "pixelHash"=i.hash,
        "pixelProcessorVersion"=${DUPLICATE_PIXEL_VERSION},"pixelStatus"=i.status
      FROM (VALUES ${Prisma.join(results.map((row) => Prisma.sql`(${row.id},${row.mediaRevision}::int,${row.proof.hash}::text,${row.proof.status})`))}) AS i(id,revision,hash,status), "EagleAsset" a
      WHERE f."assetId"=i.id AND f."ownerId"=${item.ownerId}
        AND f."libraryMode"=${mode}::"LibraryMode" AND f."mediaRevision"=i.revision
        AND a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode"
        AND a."mediaRevision"=f."mediaRevision" AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL
        AND NOT a."storageTransferredOut" AND (${item.operation.isPrivate} OR NOT a."isPrivate")`;
    await completeDuplicateItem(tx, item, mode);
  });
}
