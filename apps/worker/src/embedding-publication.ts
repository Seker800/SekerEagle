import type { EmbeddingSpaceIdentity } from './embedding-space';
import { mediaCompletion } from '@sekereagle/library-core';
import { matchSmartFoldersForEmbedding } from '@sekereagle/library-persistence';
import {
  Prisma,
  type PrismaClient,
  type EagleAssetProcessingJob,
  type LibraryMode,
} from '@prisma/client';

type PublicationJob = Pick<
  EagleAssetProcessingJob,
  'id' | 'ownerId' | 'libraryMode' | 'assetId' | 'assetRevision' | 'leaseVersion'
>;
type Suggest = (
  tx: Prisma.TransactionClient,
  ownerId: string,
  mode: LibraryMode,
  assetId: string,
  embeddingId: string,
) => Promise<unknown>;

/** Only database publication is inside this budget; model inference runs beforehand. */
export async function publishEmbedding(
  client: Pick<PrismaClient, '$transaction'>,
  job: PublicationJob,
  recordId: string,
  embedding: readonly number[],
  suggest: Suggest,
): Promise<void> {
  await client.$transaction(
    async (transaction) => {
      // Asset-first ordering matches replacement. Never publish a superseded media revision.
      const visible = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "EagleAsset" WHERE id=${job.assetId} AND "ownerId"=${job.ownerId}
          AND "libraryMode"=${job.libraryMode}::"LibraryMode" AND "mediaRevision"=${job.assetRevision}
          AND "deletedAt" IS NULL AND "storageTransferredOut"=false
        FOR SHARE`);
      if (!visible.length) return;
      const scope = {
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        assetId: job.assetId,
        assetRevision: job.assetRevision,
      };
      const completed = await transaction.eagleAssetProcessingJob.updateMany({
        ...mediaCompletion(job),
      });
      if (completed.count !== 1) return;
      await transaction.eagleAssetEmbedding.updateMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          isCurrent: true,
        },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      const published = await transaction.eagleAssetEmbedding.updateMany({
        where: { id: recordId, ...scope },
        data: {
          status: 'READY',
          isCurrent: true,
          l2Norm: 1,
          errorCode: null,
          completedAt: new Date(),
        },
      });
      if (published.count !== 1) throw new Error('EMBEDDING_RECORD_NOT_OWNED');
      const vector = `[${embedding.join(',')}]`;
      await transaction.$executeRaw(
        Prisma.sql`UPDATE "EagleAssetEmbedding" SET "embedding" = ${vector}::vector WHERE "ownerId" = ${job.ownerId} AND "libraryMode" = ${job.libraryMode}::"LibraryMode" AND "id" = ${recordId}`,
      );
      await matchSmartFoldersForEmbedding(transaction, job, recordId);
      await suggest(transaction, job.ownerId, job.libraryMode, job.assetId, recordId);
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

/** Reuse an intrinsic vector copied by SEND; index work belongs to the independent worker. */
export async function publishStoredEmbedding(
  client: Pick<PrismaClient, '$transaction'>,
  job: PublicationJob,
  identity: EmbeddingSpaceIdentity,
  suggest: Suggest,
): Promise<boolean> {
  return client.$transaction(
    async (tx) => {
      const visible = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "EagleAsset" WHERE id=${job.assetId} AND "ownerId"=${job.ownerId}
        AND "libraryMode"=${job.libraryMode}::"LibraryMode" AND "mediaRevision"=${job.assetRevision}
        AND "deletedAt" IS NULL AND "storageTransferredOut"=false FOR SHARE`);
      if (!visible.length) {
        const completion = mediaCompletion(job);
        await tx.eagleAssetProcessingJob.updateMany({
          ...completion,
          data: { ...completion.data, lastError: 'ASSET_TRASHED' },
        });
        return true;
      }
      const records = await tx.$queryRaw<
        Array<{ id: string; status: string; isCurrent: boolean }>
      >(Prisma.sql`
      SELECT e.id,e.status,e."isCurrent" FROM "EagleAssetEmbedding" e
      JOIN "EagleEmbeddingSpace" s ON s.id=e."spaceId"
      WHERE e."ownerId"=${job.ownerId} AND e."libraryMode"=${job.libraryMode}::"LibraryMode"
        AND e."assetId"=${job.assetId} AND e."assetRevision"=${job.assetRevision}
        AND e.embedding IS NOT NULL AND e."l2Norm" BETWEEN 0.99 AND 1.01
        AND s.id=${identity.id} AND s."isCurrent" AND s.model=${identity.model}
        AND s.revision=${identity.revision} AND s.dimensions=${identity.dimensions}
        AND s.normalized=${identity.normalized} AND s.normalized
        AND s."instructionVersion"=${identity.instructionVersion}
        AND s."preprocessingVersion"=${identity.preprocessingVersion}
      FOR SHARE OF s`);
      const record = records[0];
      if (!record) return false;
      const completed = await tx.eagleAssetProcessingJob.updateMany(mediaCompletion(job));
      if (completed.count !== 1) return true;
      if (record.status === 'READY' && record.isCurrent) return true;
      await tx.eagleAssetEmbedding.updateMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          isCurrent: true,
          id: { not: record.id },
        },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      const published = await tx.eagleAssetEmbedding.updateMany({
        where: {
          id: record.id,
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          spaceId: identity.id,
        },
        data: { status: 'READY', isCurrent: true, errorCode: null, completedAt: new Date() },
      });
      if (published.count !== 1) throw new Error('EMBEDDING_RECORD_NOT_OWNED');
      await matchSmartFoldersForEmbedding(tx, job, record.id);
      await suggest(tx, job.ownerId, job.libraryMode, job.assetId, record.id);
      return true;
    },
    { maxWait: 5000, timeout: 30000 },
  );
}
