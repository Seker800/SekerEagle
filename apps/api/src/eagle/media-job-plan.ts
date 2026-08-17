import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export const RENDITION_PROCESSOR_VERSION = 'rendition-v2';
export const COLOR_THUMBNAIL_PROCESSOR_VERSION = 'color-v3-thumbnail';
export const PYRAMID_PROCESSOR_VERSION = 'pyramid-v1';
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
  const renditionJobId = existingRendition?.id ?? newRenditionJobId;
  const jobs: Prisma.EagleAssetProcessingJobCreateManyInput[] = [];
  if (!existingRendition) {
    jobs.push({
      id: newRenditionJobId,
      ...common,
      kind: 'GENERATE_RENDITIONS',
      lane: 'INTERACTIVE',
      processorVersion: RENDITION_PROCESSOR_VERSION,
      dependsOnJobId: null,
    });
  }
  const hasPalette = existingJobs.some(
    ({ kind, processorVersion }) =>
      kind === 'EXTRACT_COLOR_PALETTE' && processorVersion === COLOR_THUMBNAIL_PROCESSOR_VERSION,
  );
  if (!hasPalette) {
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
  if (needsImagePyramid(input.width, input.height) && !hasPyramid) {
    jobs.push({
      id: randomUUID(),
      ...common,
      kind: 'GENERATE_IMAGE_PYRAMID',
      lane: 'BACKGROUND',
      processorVersion: PYRAMID_PROCESSOR_VERSION,
      dependsOnJobId: renditionJobId,
    });
  }
  return jobs;
}
