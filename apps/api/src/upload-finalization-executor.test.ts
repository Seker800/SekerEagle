import assert from 'node:assert/strict';
import test from 'node:test';
import { UploadFinalizationExecutor } from './upload-finalization-executor';

const job = {
  id: 'job-1',
  uploadSessionId: 'session-1',
  attempts: 1,
  libraryMode: 'PHOTO' as const,
};

function executor(options: {
  claim?: typeof job | null;
  session?: Record<string, unknown> | null;
  recover?: () => Promise<unknown>;
  onJobUpdate?: (data: Record<string, unknown>) => void;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const finalized: unknown[] = [];
  let claimed = false;
  const prisma = {
    $queryRaw: async () => {
      if (claimed) return [];
      claimed = true;
      return options.claim === undefined ? [job] : options.claim ? [options.claim] : [];
    },
    uploadSession: {
      findFirst: async () => options.session ?? null,
    },
    uploadFinalizationJob: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        options.onJobUpdate?.(data);
        return data;
      },
    },
  };
  const uploads = {
    MATERIAL: { recoverUploadSession: async () => options.recover?.() },
    PHOTO: { recoverUploadSession: async () => options.recover?.() },
  };
  const imports = {
    finalizeUpload: async (...args: unknown[]) => {
      finalized.push(args);
    },
  };
  return {
    executor: new UploadFinalizationExecutor(prisma as never, uploads as never, imports as never),
    updates,
    finalized,
  };
}

test('claimed uploads publish once and complete their durable job', async () => {
  const {
    executor: run,
    updates,
    finalized,
  } = executor({
    session: { status: 'ASSEMBLED', uploaderId: 'owner-1', finalizationAttempts: 0 },
    recover: async () => ({
      uploadSessionId: 'session-1',
      assetId: 'asset-1',
      status: 'PROCESSING',
      duplicate: false,
    }),
  });
  await run.tick();
  assert.deepEqual(finalized, [['owner-1', 'session-1', 'asset-1']]);
  assert.deepEqual(updates[0], { status: 'COMPLETED', lockedAt: null, lastError: null });
});

test('a terminal session failure fails the job instead of retrying forever', async () => {
  const { executor: run, updates } = executor({
    session: { status: 'FAILED', uploaderId: 'owner-1', finalizationAttempts: 10 },
    recover: async () => {
      throw new Error('INVALID_MEDIA');
    },
  });
  await run.tick();
  assert.equal(updates[0]?.status, 'FAILED');
});

test('a transient failure returns the job to the durable queue with backoff', async () => {
  const { executor: run, updates } = executor({
    session: { status: 'FAILED', uploaderId: 'owner-1', finalizationAttempts: 2 },
    recover: async () => {
      throw new Error('temporarily busy');
    },
  });
  await run.tick();
  assert.equal(updates[0]?.status, 'PENDING');
  assert.equal(updates[0]?.lockedAt, null);
});

test('an aborted session leaves no queued upload behind', async () => {
  const { executor: run, updates } = executor({
    session: { status: 'ABORTED', uploaderId: 'owner-1', finalizationAttempts: 0 },
    recover: async () => assert.fail('aborted sessions must not be inspected'),
  });
  await run.tick();
  assert.equal(updates[0]?.status, 'COMPLETED');
});

test('an idle queue does not touch the database beyond the claim', async () => {
  const { executor: run, updates } = executor({ claim: null });
  await run.tick();
  assert.deepEqual(updates, []);
});
