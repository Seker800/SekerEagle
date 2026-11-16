import {
  mediaExecutionGuard,
  mediaFailure,
  mediaWaitData,
  MediaLeaseRecoveryExhaustedError,
} from '@sekereagle/library-core';
import { terminalAssetFailure } from '../processing-policy';
import { propagateFailedDependencies } from '../job-recovery';
import { embeddingBackoff, embeddingRetry } from '../embedding-retry';
import type { EmbeddingClientError } from '../embedding-client';
import { isPermanentMediaValidationError } from '../media-validation-error';
import { RemoteMediaUnavailableError } from '../remote-media';
import type { EagleAssetProcessingJob } from '@prisma/client';
import type { MediaJobContext } from './types';

export async function failJob(
  job: EagleAssetProcessingJob,
  error: unknown,
  context: MediaJobContext,
): Promise<void> {
  if (error instanceof RemoteMediaUnavailableError) {
    if (error.deferResource) context.resourcePool.defer('REMOTE_MEDIA', 1000);
    await context.prisma.eagleAssetProcessingJob.updateMany({
      where: mediaExecutionGuard(job),
      data: mediaWaitData(job.attempts, 1000, 'WAITING_REMOTE_MEDIA_CAPACITY'),
    });
    return;
  }
  const retry = embeddingRetry(error, job.attempts);
  if (retry) {
    const backoff = embeddingBackoff(error);
    if (
      backoff?.reason === 'WAITING_EMBEDDING_CAPACITY' &&
      (error as EmbeddingClientError).deferResource
    )
      context.resourcePool.defer('EMBEDDING', backoff.delayMs);
    await context.prisma.eagleAssetProcessingJob.updateMany({
      where: mediaExecutionGuard(job),
      data: retry.data,
    });
    return;
  }

  const message =
    error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_PROCESSING_ERROR';
  const permanent =
    error instanceof MediaLeaseRecoveryExhaustedError ||
    isPermanentMediaValidationError(error) ||
    (job.kind === 'RENDER_EDITED_COPY' && message.startsWith('EDIT_SOURCE_'));
  const transition = mediaFailure(job, {
    message: message,
    permanent: permanent,
    now: new Date(),
    expiredBefore:
      error instanceof MediaLeaseRecoveryExhaustedError ? error.expiredBefore : undefined,
  });
  const { terminal } = transition;
  await context.prisma.$transaction(async (transaction) => {
    const failed = await transaction.eagleAssetProcessingJob.updateMany({
      where: transition.where,
      data: transition.data,
    });
    if (failed.count !== 1) return;
    if (terminal) await propagateFailedDependencies(transaction);
    if (job.kind === 'EXTRACT_COLOR_PALETTE') {
      await transaction.eagleAssetColorAnalysis.upsert({
        where: {
          assetId_assetRevision_processorVersion: {
            assetId: job.assetId,
            assetRevision: job.assetRevision,
            processorVersion: job.processorVersion,
          },
        },
        create: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          processorVersion: job.processorVersion,
          status: terminal ? 'FAILED' : 'PENDING',
          lastError: message,
          completedAt: terminal ? new Date() : null,
        },
        update: {
          status: terminal ? 'FAILED' : 'PENDING',
          lastError: message,
          completedAt: terminal ? new Date() : null,
        },
      });
    }
    if (job.kind === 'GENERATE_IMAGE_PYRAMID') {
      await transaction.eagleImagePyramid.updateMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          revision: job.assetRevision,
          processorVersion: job.processorVersion,
        },
        data: {
          status: terminal ? 'FAILED' : 'PENDING',
          lastError: message,
          completedAt: terminal ? new Date() : null,
        },
      });
    }
    if (job.kind === 'GENERATE_EMBEDDING') {
      await transaction.eagleAssetEmbedding.updateMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          spaceId: context.embeddingSpaceId,
        },
        data: {
          status: 'FAILED',
          errorCode: message.slice(0, 100),
          completedAt: new Date(),
        },
      });
    }
    const assetFailure = terminal
      ? terminalAssetFailure(job.kind, job.processorVersion, message)
      : null;
    if (assetFailure) {
      await transaction.eagleAsset.updateMany({
        where: {
          id: job.assetId,
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          mediaRevision: job.assetRevision,
          ...(assetFailure.lifecycleStatus ? {} : { lifecycleStatus: { not: 'FAILED' as const } }),
        },
        data: assetFailure,
      });
    }
  });
}
