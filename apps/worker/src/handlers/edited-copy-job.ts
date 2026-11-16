import { renderEditedCopy } from '../edited-copy-render';
import type { JobHandler } from './types';

export const editedCopyJob: JobHandler = async ({ job, context }) => {
  await renderEditedCopy(context.prisma, context.storage, context.s3Bucket, job);
};
