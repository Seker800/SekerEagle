import type { EagleAssetProcessingJob } from '@prisma/client';

type AiTagJobIdentity = Pick<
  EagleAssetProcessingJob,
  'id' | 'ownerId' | 'assetId' | 'assetRevision' | 'processorVersion' | 'leaseVersion'
>;

interface AiTagCompletionClient {
  eagleAiAnalysisRun: {
    findFirst(input: {
      where: {
        ownerId: string;
        assetId: string;
        assetRevision: number;
        processorVersion: string;
        status: { in: ['SUCCEEDED', 'SUPERSEDED'] };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  eagleAssetProcessingJob: {
    updateMany(input: {
      where: { id: string; status: 'PROCESSING'; leaseVersion: number };
      data: {
        status: 'COMPLETED';
        completedAt: Date;
        lockedAt: null;
        lastError: null;
      };
    }): Promise<{ count: number }>;
  };
}

export async function finishAlreadyAnalyzedAiTagJob(
  client: AiTagCompletionClient,
  job: AiTagJobIdentity,
): Promise<boolean> {
  const run = await client.eagleAiAnalysisRun.findFirst({
    where: {
      ownerId: job.ownerId,
      assetId: job.assetId,
      assetRevision: job.assetRevision,
      processorVersion: job.processorVersion,
      status: { in: ['SUCCEEDED', 'SUPERSEDED'] },
    },
    select: { id: true },
  });
  if (!run) return false;
  await client.eagleAssetProcessingJob.updateMany({
    where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
    data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
  });
  return true;
}
