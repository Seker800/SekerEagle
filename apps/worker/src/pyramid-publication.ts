import type { PrismaClient } from '@prisma/client';
import { lockOwnerPrivacyProjection } from '@sekereagle/library-persistence';
import { assertDeletionKey } from './asset-purge';
import { beginMediaPublication, type MediaPublicationJob } from './media-publication';
import type { MediaOutputAttempt } from './media-output-attempt';
import type { buildPyramidDescriptor } from './image-pyramid';

export async function publishPyramid(
  client: Pick<PrismaClient, '$transaction'>,
  input: {
    job: MediaPublicationJob & { processorVersion: string };
    descriptor: ReturnType<typeof buildPyramidDescriptor>;
    storagePrefix: string;
    tileCount: number;
    byteSize: bigint;
    outputAttempt: Pick<MediaOutputAttempt, 'publish'>;
  },
  dependencies = { lockPrivacy: lockOwnerPrivacyProjection },
) {
  const { job } = input;
  const storagePrefix = input.storagePrefix.replace(/\/+$/, '');
  assertDeletionKey(job.ownerId, storagePrefix);
  if (
    !storagePrefix.startsWith(
      `users/${job.ownerId}/assets/${job.assetId}/pyramids/${job.assetRevision}/`,
    )
  )
    throw new Error('PYRAMID_PUBLICATION_SCOPE');
  return client.$transaction(
    async (tx) => {
      if (!(await beginMediaPublication(tx, job, { lockPrivacy: dependencies.lockPrivacy })))
        return false;
      const where = {
        assetId_revision_processorVersion: {
          assetId: job.assetId,
          revision: job.assetRevision,
          processorVersion: job.processorVersion,
        },
      };
      const previous = await tx.eagleImagePyramid.findUnique({
        where,
        select: { storagePrefix: true },
      });
      if (previous && previous.storagePrefix !== storagePrefix) {
        const retired = `${previous.storagePrefix.replace(/\/+$/, '')}/`;
        assertDeletionKey(job.ownerId, retired);
        if (storagePrefix.startsWith(retired)) throw new Error('PYRAMID_OUTPUT_OVERLAP');
        await tx.eagleObjectDeletion.create({
          data: {
            ownerId: job.ownerId,
            libraryMode: job.libraryMode,
            objectKeys: [],
            prefixes: [retired],
          },
        });
      }
      const data = {
        status: 'READY' as const,
        storagePrefix,
        tileCount: input.tileCount,
        byteSize: input.byteSize,
        completedAt: new Date(),
        lastError: null,
        ...input.descriptor,
      };
      await tx.eagleImagePyramid.upsert({
        where,
        create: {
          ...data,
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          revision: job.assetRevision,
          processorVersion: job.processorVersion,
        },
        update: data,
      });
      await input.outputAttempt.publish(tx);
      return true;
    },
    { timeout: 30000 },
  );
}
