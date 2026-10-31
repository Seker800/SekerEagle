import { readDuplicateCandidates } from './eagle-duplicate-candidates';
import { ConflictException } from '@nestjs/common';
import { completeDuplicateItem } from './eagle-duplicate-item';
import { Prisma, type LibraryMode } from '@prisma/client';
import {
  findVerifiedPixelGroups,
  DUPLICATE_GROUPING_VERSION,
  type DuplicateFingerprint,
} from '@sekereagle/library-core';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { lockOwnerPrivacyProjection } from './eagle-privacy.service';
import {
  signature,
  inDuplicateLibrary,
  type Item,
  type ScanSnapshot,
} from './eagle-duplicate-model';
import { DUPLICATE_FINGERPRINT_VERSION, fingerprintPreview } from './eagle-duplicate-fingerprint';
import {
  scheduleDuplicateVerification,
  executeDuplicateVerification,
} from './eagle-duplicate-verification';
async function buildProjection(
  prisma: PrismaService,
  libraryMode: LibraryMode,
  item: Item,
  assertActor: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const candidates = await readDuplicateCandidates(
    prisma,
    item.ownerId,
    libraryMode,
    item.operation.isPrivate,
  );
  const byId = new Map(candidates.map((row) => [row.id, row]));
  const groups = findVerifiedPixelGroups(candidates);
  await prisma.$transaction(
    async (tx) => {
      await lockOwnerPrivacyProjection(tx, item.ownerId, libraryMode);
      await assertActor(tx);
      await tx.eagleDuplicateGroup.deleteMany({
        where: {
          ownerId: item.ownerId,
          libraryMode: libraryMode,
          ...(item.operation.isPrivate ? {} : { isPrivate: false }),
        },
      });
      for (let offset = 0; offset < groups.length; offset += 500)
        await tx.eagleDuplicateGroup.createMany({
          data: groups.slice(offset, offset + 500).map((group) => ({
            ownerId: item.ownerId,
            libraryMode: libraryMode,
            signature: signature(item.ownerId, libraryMode, group, byId),
            algorithmVersion: DUPLICATE_GROUPING_VERSION,
            assetIds: group.assetIds,
            rowVersions: group.assetIds.map((id) => byId.get(id)!.rowVersion),
            mediaRevisions: group.assetIds.map((id) => byId.get(id)!.mediaRevision),
            isPrivate: byId.get(group.recommendedId)!.isPrivate,
            removableBytes: BigInt(group.removableBytes),
          })),
        });
      await assertActor(tx);
      await completeDuplicateItem(tx, item, libraryMode);
    },
    { timeout: 45_000 },
  );
}
export async function executeDuplicateIndex(
  prisma: PrismaService,
  storage: ObjectStorageService,
  libraryMode: LibraryMode,
  item: Item,
  assertActor: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const snapshot = item.snapshots as unknown as ScanSnapshot;
  if (snapshot.kind === 'build')
    return scheduleDuplicateVerification(prisma, libraryMode, item, assertActor);
  if (snapshot.kind === 'verify')
    return executeDuplicateVerification(prisma, storage, libraryMode, item, assertActor);
  if (snapshot.kind === 'publish') return buildProjection(prisma, libraryMode, item, assertActor);
  const rows = await prisma.eagleAsset.findMany({
    where: {
      ...inDuplicateLibrary(item.ownerId, libraryMode, item.operation.isPrivate),
      id: { in: item.assetIds },
    },
    include: {
      duplicateFingerprint: true,
      renditions: { where: { status: 'READY', kind: 'THUMBNAIL' }, orderBy: { byteSize: 'asc' } },
    },
  });
  const results: Array<{ id: string; mediaRevision: number; fingerprint: DuplicateFingerprint }> =
    [];
  // Two preview reads bound network buffers and decoder memory; the durable batch is never a product quota.
  for (let offset = 0; offset < rows.length; offset += 2)
    await Promise.all(
      rows.slice(offset, offset + 2).map(async (row) => {
        const expected = snapshot.rows.find((r) => r.id === row.id);
        if (!expected || expected.mediaRevision !== row.mediaRevision) return;
        if (
          row.duplicateFingerprint?.mediaRevision === row.mediaRevision &&
          row.duplicateFingerprint.processorVersion === DUPLICATE_FINGERPRINT_VERSION
        )
          return;
        const rendition = row.renditions.find(
          (r) => r.revision === row.mediaRevision && r.mimeType.startsWith('image/'),
        );
        if (!rendition) throw new ConflictException('缩略图尚未就绪，请稍后重试。');
        const signal = AbortSignal.timeout(10_000);
        const response = await storage.getObject(rendition.storageKey, {
          abortSignal: signal,
        });
        const chunks: Buffer[] = [];
        let bytes = 0;
        const maxBytes = Number(process.env.EAGLE_DUPLICATE_PREVIEW_MAX_BYTES ?? 2_097_152);
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
          throw new Error('INVALID_DUPLICATE_PREVIEW_BUDGET');
        const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
        try {
          for await (const chunk of body) {
            bytes += chunk.length;
            if (bytes > maxBytes) throw new Error('DUPLICATE_PREVIEW_TOO_LARGE');
            chunks.push(Buffer.from(chunk));
          }
        } finally {
          body.destroy?.();
        }
        results.push({
          id: row.id,
          mediaRevision: row.mediaRevision,
          fingerprint: await fingerprintPreview(Buffer.concat(chunks)),
        });
      }),
    );
  await prisma.$transaction(
    async (tx) => {
      await lockOwnerPrivacyProjection(tx, item.ownerId, libraryMode);
      await assertActor(tx);
      if (results.length)
        await tx.$executeRaw`
        INSERT INTO "EagleDuplicateFingerprint" AS f
          ("assetId","ownerId","libraryMode","mediaRevision","processorVersion",hash,colors,contrast,"updatedAt")
        SELECT i.id,${item.ownerId},${libraryMode}::"LibraryMode",i.revision,${DUPLICATE_FINGERPRINT_VERSION},i.hash,i.colors,i.contrast,CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(results.map((result) => Prisma.sql`(${result.id},${result.mediaRevision},${result.fingerprint.hash},${JSON.stringify(result.fingerprint.colors)}::jsonb,${result.fingerprint.contrast}::float8)`))}) AS i(id,revision,hash,colors,contrast)
        JOIN "EagleAsset" a ON a.id=i.id AND a."ownerId"=${item.ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
          AND a."mediaRevision"=i.revision AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL AND NOT a."storageTransferredOut"
          AND (${item.operation.isPrivate} OR NOT a."isPrivate")
        ON CONFLICT ("assetId") DO UPDATE SET "mediaRevision"=excluded."mediaRevision","processorVersion"=excluded."processorVersion",
          "pixelHash"=CASE WHEN f."mediaRevision"=excluded."mediaRevision" THEN f."pixelHash" ELSE NULL END,
          "pixelProcessorVersion"=CASE WHEN f."mediaRevision"=excluded."mediaRevision" THEN f."pixelProcessorVersion" ELSE NULL END,
          "pixelStatus"=CASE WHEN f."mediaRevision"=excluded."mediaRevision" THEN f."pixelStatus" ELSE NULL END,
          hash=excluded.hash,colors=excluded.colors,contrast=excluded.contrast,"updatedAt"=excluded."updatedAt"
        WHERE f."ownerId"=excluded."ownerId" AND f."libraryMode"=excluded."libraryMode"`;
      await assertActor(tx);
      await completeDuplicateItem(tx, item, libraryMode);
    },
    { timeout: 30_000 },
  );
}
