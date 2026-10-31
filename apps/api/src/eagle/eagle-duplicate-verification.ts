import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Prisma, type LibraryMode } from '@prisma/client';
import {
  DUPLICATE_GROUPING_VERSION,
  DUPLICATE_PIXEL_VERSION,
  findDuplicateGroups,
} from '@sekereagle/library-core';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { readDuplicateCandidates } from './eagle-duplicate-candidates';
import { inDuplicateLibrary, type Item, type ScanSnapshot } from './eagle-duplicate-model';
import { completeDuplicateItem } from './eagle-duplicate-item';
import {
  verifyDuplicateOriginal,
  duplicateOriginalPixelLimit,
  withDuplicateOriginalSlot,
  type OriginalProof,
} from './eagle-duplicate-original';

/** Expand discovery once, after previews finish; durable ordinals keep restart/retry idempotent. */
export async function scheduleDuplicateVerification(
  prisma: PrismaService,
  mode: LibraryMode,
  item: Item,
  assertActor: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const rows = await readDuplicateCandidates(prisma, item.ownerId, mode, item.operation.isPrivate);
  const ids = new Set(
    findDuplicateGroups(rows)
      .filter((g) => g.kind === 'SIMILAR')
      .flatMap((g) => g.assetIds),
  );
  // Flat pictures are intentionally absent from approximate matching, but can still be exact copies.
  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.fingerprint || row.isEdited || row.isLivePhoto) continue;
    const key = JSON.stringify([
      row.isPrivate,
      row.format,
      row.width,
      row.height,
      row.fingerprint.hash,
      row.fingerprint.colors,
    ]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row.id);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values())
    if (bucket.length > 1) for (const id of bucket) ids.add(id);
  const missing: Array<{ id: string; rowVersion: number; mediaRevision: number }> = [];
  const candidates = rows.filter((row) => ids.has(row.id) && !row.isEdited && !row.isLivePhoto);
  const pixelLimit = duplicateOriginalPixelLimit();
  for (let offset = 0; offset < candidates.length; offset += 500) {
    const part = candidates.slice(offset, offset + 500);
    const cached = await prisma.eagleDuplicateFingerprint.findMany({
      where: {
        ownerId: item.ownerId,
        libraryMode: mode,
        assetId: { in: part.map((r) => r.id) },
        pixelProcessorVersion: DUPLICATE_PIXEL_VERSION,
        pixelStatus: { in: ['VERIFIED', 'UNSUPPORTED', 'PIXEL_LIMIT'] },
      },
      select: { assetId: true, mediaRevision: true, pixelStatus: true },
    });
    const byId = new Map(cached.map((r) => [r.assetId, r]));
    for (const row of part) {
      const proof = byId.get(row.id);
      // Reuse only a proven exclusion still beyond the current budget. Raising it retries the original.
      const stillOverBudget = !!row.width && !!row.height && row.width * row.height > pixelLimit;
      if (
        proof?.mediaRevision !== row.mediaRevision ||
        (proof.pixelStatus === 'PIXEL_LIMIT' && !stillOverBudget)
      )
        missing.push({ id: row.id, rowVersion: row.rowVersion, mediaRevision: row.mediaRevision });
    }
  }
  await prisma.$transaction(
    async (tx) => {
      await assertActor(tx);
      const existing = await tx.eagleAssetOperationItem.count({
        where: {
          operationId: item.operationId,
          ownerId: item.ownerId,
          libraryMode: mode,
          ordinal: { gt: item.ordinal },
        },
      });
      if (!existing) {
        const jobs = [
          ...Array.from({ length: Math.ceil(missing.length / 4) }, (_, i) => {
            const rows = missing.slice(i * 4, i * 4 + 4);
            return {
              assetIds: rows.map((row) => row.id),
              weight: rows.length,
              snapshots: { kind: 'verify', rows },
            };
          }),
          {
            assetIds: [],
            weight: 1,
            snapshots: { kind: 'publish', version: DUPLICATE_GROUPING_VERSION } as ScanSnapshot,
          },
        ];
        for (let offset = 0; offset < jobs.length; offset += 500)
          await tx.eagleAssetOperationItem.createMany({
            data: jobs.slice(offset, offset + 500).map((job, i) => ({
              ...job,
              id: randomUUID(),
              operationId: item.operationId,
              ownerId: item.ownerId,
              libraryMode: mode,
              ordinal: item.ordinal + offset + i + 1,
            })),
          });
      }
      await completeDuplicateItem(tx, item, mode);
    },
    { timeout: 30_000 },
  );
}

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
