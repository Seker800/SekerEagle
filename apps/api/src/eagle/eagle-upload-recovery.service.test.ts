import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleUploadRecoveryService } from './eagle-upload-recovery.service';

test('recovery retries every recoverable upload session without stopping on one failure', async () => {
  const recovered: string[] = [];
  const recovery = new EagleUploadRecoveryService(
    {
      uploadSession: {
        updateMany: async () => ({ count: 1 }),
        findMany: async ({ where }: { where: { objectCleanupPending?: boolean } }) =>
          where.objectCleanupPending
            ? []
            : [
                { id: 'assembled-1', uploaderId: 'owner-1' },
                { id: 'failed-1', uploaderId: 'owner-1' },
                { id: 'assembled-2', uploaderId: 'owner-1' },
              ],
      },
      eagleUploadSessionState: { findMany: async () => [] },
    } as never,
    {
      recoverUploadSession: async (sessionId: string) => {
        recovered.push(sessionId);
        if (sessionId === 'failed-1') throw new Error('transient failure');
      },
    } as never,
    {
      finalizeUpload: async () => undefined,
      markUploadFailed: async () => undefined,
    } as never,
    {} as never,
    'MATERIAL',
  );

  await recovery.recoverPendingFinalizations();

  assert.deepEqual(recovered, ['assembled-1', 'failed-1', 'assembled-2']);
});

test('expired and exhausted uploads retain cleanup intent until multipart abort and object deletion succeed', async () => {
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let failDelete = true;
  let acknowledged = 0;
  const recovery = new EagleUploadRecoveryService(
    {
      uploadSession: {
        updateMany: async (input: (typeof writes)[number]) => {
          writes.push(input);
          if (input.data.objectCleanupPending === false) acknowledged++;
          return { count: 1 };
        },
        findMany: async ({ where }: { where: { objectCleanupPending?: boolean } }) =>
          where.objectCleanupPending
            ? [
                {
                  id: 'expired',
                  objectKey: 'users/owner-1/temp',
                  multipartUploadId: 'upload-1',
                  status: 'ABORTED',
                },
              ]
            : [],
      },
      eagleUploadSessionState: { findMany: async () => [] },
    } as never,
    {} as never,
    {} as never,
    {
      abortMultipartUpload: async () => {
        const error = new Error('already removed');
        error.name = 'NoSuchUpload';
        throw error;
      },
      deleteObject: async () => {
        if (failDelete) throw new Error('temporary storage failure');
      },
    } as never,
    'PHOTO',
  );
  await recovery.recoverPendingFinalizations();
  assert.equal(acknowledged, 0);
  const expired = writes.find((write) => write.data.lastError === 'UPLOAD_EXPIRED');
  assert.equal(expired?.where.libraryMode, 'PHOTO');
  assert.equal(expired?.where.status, 'INITIATED');
  assert.equal(expired?.data.objectCleanupPending, true);
  failDelete = false;
  await recovery.recoverPendingFinalizations();
  assert.equal(acknowledged, 1);
});
