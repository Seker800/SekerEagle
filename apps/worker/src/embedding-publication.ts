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
      const scope = {
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        assetId: job.assetId,
        assetRevision: job.assetRevision,
      };
      const completed = await transaction.eagleAssetProcessingJob.updateMany({
        where: { id: job.id, ...scope, status: 'PROCESSING', leaseVersion: job.leaseVersion },
        data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
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
      await suggest(transaction, job.ownerId, job.libraryMode, job.assetId, recordId);
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}
