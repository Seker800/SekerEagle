import type { S3Client } from '@aws-sdk/client-s3';
import type { EagleAssetProcessingJob, PrismaClient } from '@prisma/client';
import type { MediaJobKind } from '@sekereagle/library-core';
import type { EmbeddingProcessor } from '../embedding-job';
import type { MediaResourcePool } from '../media-resource-pool';
import type { RemoteMediaClient } from '../remote-media';
import type { JobMediaAsset } from './job-asset';

export interface MediaJobContext {
  prisma: PrismaClient;
  storage: S3Client;
  s3Bucket: string;
  remoteMediaClient: RemoteMediaClient;
  embeddingProcessor: EmbeddingProcessor;
  runVideoTranscoding: boolean;
  facesConfigured: boolean;
  remoteKinds: () => readonly MediaJobKind[];
  resourcePool: MediaResourcePool;
  embeddingSpaceId: string;
  embeddingDimensions: number;
}

export interface JobExecution {
  job: EagleAssetProcessingJob;
  remoteRequired: boolean;
  context: MediaJobContext;
}

export type JobHandler = (execution: JobExecution) => Promise<void>;
export type AssetFamilyHandler = (execution: JobExecution, asset: JobMediaAsset) => Promise<void>;
