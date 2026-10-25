import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export const RENDITION_PROCESSOR_VERSION = 'rendition-v2';
export const COLOR_THUMBNAIL_PROCESSOR_VERSION = 'color-v3-thumbnail';
export const PYRAMID_PROCESSOR_VERSION = 'pyramid-v1';
export const EMBEDDING_PROCESSOR_VERSION = 'qwen3-vl-embedding-2b-1024-v1';
export const IMAGE_PYRAMID_DIMENSION_THRESHOLD = 4_096;
export const IMAGE_PYRAMID_PIXEL_THRESHOLD = 16_000_000;

export function needsImagePyramid(width: number | null, height: number | null): boolean {
  if (width === null || height === null) return false;
  return (
    Math.max(width, height) > IMAGE_PYRAMID_DIMENSION_THRESHOLD ||
    width * height > IMAGE_PYRAMID_PIXEL_THRESHOLD
  );
}

export function buildImageProcessingJobs(
  input: {
    ownerId: string;
    assetId: string;
    assetRevision: number;
    width: number | null;
    height: number | null;
    renditionsReady?: boolean;
    detailsReady?: boolean;
    needsDetails?: boolean;
    paletteReady?: boolean;
    pyramidReady?: boolean;
    embeddingReady?: boolean;
  },
  renditionJobId: string = randomUUID(),
): Prisma.EagleAssetProcessingJobCreateManyInput[] {
  return buildMissingImageProcessingJobs(input, [], renditionJobId);
}

export function buildMissingImageProcessingJobs(
  input: {
    ownerId: string;
    assetId: string;
    assetRevision: number;
    width: number | null;
    height: number | null;
    renditionsReady?: boolean;
    detailsReady?: boolean;
    needsDetails?: boolean;
    paletteReady?: boolean;
    pyramidReady?: boolean;
    embeddingReady?: boolean;
  },
  existingJobs: ReadonlyArray<{ id: string; kind: string; processorVersion: string }>,
  newRenditionJobId: string = randomUUID(),
): Prisma.EagleAssetProcessingJobCreateManyInput[] {
  const common = {
    ownerId: input.ownerId,
    assetId: input.assetId,
    assetRevision: input.assetRevision,
  };
  const existingRendition = existingJobs.find(
    ({ kind, processorVersion }) =>
      kind === 'GENERATE_RENDITIONS' && processorVersion === RENDITION_PROCESSOR_VERSION,
  );
  const renditionJobId =
    existingRendition?.id ?? (input.renditionsReady ? null : newRenditionJobId);
  const jobs: Prisma.EagleAssetProcessingJobCreateManyInput[] = [];
  if (!existingRendition && !input.renditionsReady) {
    jobs.push({
      id: newRenditionJobId,
      ...common,
      kind: 'GENERATE_RENDITIONS',
      lane: 'INTERACTIVE',
      processorVersion: RENDITION_PROCESSOR_VERSION,
      dependsOnJobId: null,
    });
  }
  if (
    input.needsDetails &&
    !input.detailsReady &&
    !existingJobs.some((job) => job.processorVersion === 'photo-source-details-v1')
  ) {
    jobs.push({
      id: randomUUID(),
      ...common,
      kind: 'GENERATE_RENDITIONS',
      lane: 'BACKGROUND',
      processorVersion: 'photo-source-details-v1',
      dependsOnJobId: renditionJobId,
    });
  }
  const hasPalette = existingJobs.some(
    ({ kind, processorVersion }) =>
      kind === 'EXTRACT_COLOR_PALETTE' && processorVersion === COLOR_THUMBNAIL_PROCESSOR_VERSION,
  );
  if (!hasPalette && !input.paletteReady) {
    jobs.push({
      id: randomUUID(),
      ...common,
      kind: 'EXTRACT_COLOR_PALETTE',
      lane: 'BACKGROUND',
      processorVersion: COLOR_THUMBNAIL_PROCESSOR_VERSION,
      dependsOnJobId: renditionJobId,
    });
  }
  const hasPyramid = existingJobs.some(
    ({ kind, processorVersion }) =>
      kind === 'GENERATE_IMAGE_PYRAMID' && processorVersion === PYRAMID_PROCESSOR_VERSION,
  );
  if (needsImagePyramid(input.width, input.height) && !hasPyramid && !input.pyramidReady) {
    jobs.push({
      id: randomUUID(),
      ...common,
      kind: 'GENERATE_IMAGE_PYRAMID',
      lane: 'BACKGROUND',
      processorVersion: PYRAMID_PROCESSOR_VERSION,
      dependsOnJobId: renditionJobId,
    });
  }
  const hasEmbedding = existingJobs.some(
    ({ kind, processorVersion }) =>
      kind === 'GENERATE_EMBEDDING' && processorVersion === EMBEDDING_PROCESSOR_VERSION,
  );
  if (!hasEmbedding && !input.embeddingReady) {
    jobs.push({
      id: randomUUID(),
      ...common,
      kind: 'GENERATE_EMBEDDING',
      lane: 'BACKGROUND',
      processorVersion: EMBEDDING_PROCESSOR_VERSION,
      dependsOnJobId: renditionJobId,
    });
  }
  return jobs;
}
