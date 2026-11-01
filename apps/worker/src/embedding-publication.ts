import type { EmbeddingSpaceIdentity } from './embedding-space';
import { mediaCompletion } from '@sekereagle/library-core';
import { matchSmartFoldersForEmbedding } from '@sekereagle/library-persistence';
import {
  Prisma,
  type PrismaClient,
  type EagleAssetProcessingJob,
  type LibraryMode,
} from '@prisma/client';

export type PublicationJob = Pick<
  EagleAssetProcessingJob,
  'id' | 'ownerId' | 'libraryMode' | 'assetId' | 'assetRevision' | 'leaseVersion'
>;
export type EmbeddingSuggestionPublisher = (
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
  identity: EmbeddingSpaceIdentity,
  suggest: EmbeddingSuggestionPublisher,
): Promise<void> {
  if (
    embedding.length !== identity.dimensions ||
    embedding.some((value) => !Number.isFinite(value)) ||
    Math.abs(Math.sqrt(embedding.reduce((norm, value) => norm + value * value, 0)) - 1) > 1e-3
  )
    throw new Error('EMBEDDING_RESULT_INVALID');
  await client.$transaction(
    async (transaction) => {
      const facts = await lockPublicationFacts(transaction, job, identity);
      if (facts === 'ASSET_UNAVAILABLE') return;
      if (facts === 'SPACE_INCOMPATIBLE') throw new Error('EMBEDDING_SPACE_INCOMPATIBLE');
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
          id: { not: recordId },
        },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      const vector = `[${embedding.join(',')}]`;
      const published = await transaction.$executeRaw(Prisma.sql`
        UPDATE "EagleAssetEmbedding" SET embedding=${vector}::vector,
          status='READY', "isCurrent"=true, "l2Norm"=1, "errorCode"=NULL,
          "completedAt"=now(), "updatedAt"=now()
        WHERE id=${recordId} AND "ownerId"=${scope.ownerId}
          AND "libraryMode"=${scope.libraryMode}::"LibraryMode" AND "assetId"=${scope.assetId}
          AND "assetRevision"=${scope.assetRevision} AND "spaceId"=${identity.id}`);
      if (published !== 1) throw new Error('EMBEDDING_RECORD_NOT_OWNED');
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
  suggest: EmbeddingSuggestionPublisher,
): Promise<boolean> {
  return client.$transaction(
    async (tx) => {
      const facts = await lockPublicationFacts(tx, job, identity);
      if (facts === 'SPACE_INCOMPATIBLE') return false;
      if (facts === 'ASSET_UNAVAILABLE') {
        const completion = mediaCompletion(job);
        await tx.eagleAssetProcessingJob.updateMany({
          ...completion,
          data: { ...completion.data, lastError: 'ASSET_TRASHED' },
        });
        return true;
      }
      const records = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT e.id FROM "EagleAssetEmbedding" e
      WHERE e."ownerId"=${job.ownerId} AND e."libraryMode"=${job.libraryMode}::"LibraryMode"
        AND e."assetId"=${job.assetId} AND e."assetRevision"=${job.assetRevision}
        AND NOT e."isCurrent" AND e.status IN ('PENDING','RUNNING','FAILED')
        AND e.embedding IS NOT NULL AND e."l2Norm" BETWEEN 0.99 AND 1.01
        AND e."spaceId"=${identity.id} AND vector_dims(e.embedding)=${identity.dimensions}`);
      const record = records[0];
      if (!record) return false;
      const completed = await tx.eagleAssetProcessingJob.updateMany(mediaCompletion(job));
      if (completed.count !== 1) return true;
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

/** Asset and model identity stay locked until the original publication transaction commits. */
async function lockPublicationFacts(
  tx: Prisma.TransactionClient,
  job: PublicationJob,
  identity: EmbeddingSpaceIdentity,
): Promise<'ASSET_UNAVAILABLE' | 'SPACE_INCOMPATIBLE' | 'PUBLISHABLE'> {
  // Scalar subquery keeps a missing asset distinct from an incompatible/retired space.
  // FOR SHARE prevents replacement and identity mutation after this check.
  const visible = await tx.$queryRaw<Array<{ id: string; spaceId: string | null }>>(Prisma.sql`
    SELECT a.id, (SELECT s.id FROM "EagleEmbeddingSpace" s
      WHERE s.id=${identity.id} AND s."isCurrent" AND s.model=${identity.model}
        AND s.revision=${identity.revision} AND s.dimensions=${identity.dimensions}
        AND s.normalized=${identity.normalized} AND s.normalized
        AND s."instructionVersion"=${identity.instructionVersion}
        AND s."preprocessingVersion"=${identity.preprocessingVersion}
      FOR SHARE) AS "spaceId"
    FROM "EagleAsset" a WHERE a.id=${job.assetId} AND a."ownerId"=${job.ownerId}
      AND a."libraryMode"=${job.libraryMode}::"LibraryMode" AND a."mediaRevision"=${job.assetRevision}
      AND a."deletedAt" IS NULL AND a."storageTransferredOut"=false FOR SHARE OF a`);
  if (!visible.length) return 'ASSET_UNAVAILABLE';
  return visible[0]!.spaceId === identity.id ? 'PUBLISHABLE' : 'SPACE_INCOMPATIBLE';
}
