import { prepareAssetPurge } from '../asset-purge';
import type { JobHandler } from './types';

export const purgeJob: JobHandler = async ({ job, context }) => {
  await context.prisma.$transaction((transaction) => prepareAssetPurge(transaction, job));
};
