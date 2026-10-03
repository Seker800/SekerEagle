import assert from 'node:assert/strict';
import test from 'node:test';
import { finishAlreadyAnalyzedAiTagJob } from './ai-tag-completion';

const job = {
  id: 'job-1',
  ownerId: 'owner-1',
  assetId: 'asset-1',
  assetRevision: 2,
  processorVersion: 'processor-v2',
  leaseVersion: 3,
};

test('completed analysis consumes a duplicate queue job without running the model', async () => {
  const writes: unknown[] = [];
  const searches: unknown[] = [];
  const client = {
    eagleAiAnalysisRun: {
      findFirst: async (query: unknown) => {
        searches.push(query);
        return { id: 'run-1' };
      },
    },
    eagleAssetProcessingJob: {
      updateMany: async (query: unknown) => {
        writes.push(query);
        return { count: 1 };
      },
    },
  };

  assert.equal(await finishAlreadyAnalyzedAiTagJob(client, job), true);
  assert.deepEqual(searches, [
    {
      where: {
        ownerId: 'owner-1',
        assetId: 'asset-1',
        assetRevision: 2,
        processorVersion: 'processor-v2',
        status: { in: ['SUCCEEDED', 'SUPERSEDED'] },
      },
      select: { id: true },
    },
  ]);
  assert.equal(writes.length, 1);
  assert.deepEqual((writes[0] as { where: unknown }).where, {
    id: 'job-1',
    status: 'PROCESSING',
    leaseVersion: 3,
  });
  assert.equal((writes[0] as { data: { status: string } }).data.status, 'COMPLETED');
});

test('a missing successful analysis leaves the job available for real processing', async () => {
  const client = {
    eagleAiAnalysisRun: { findFirst: async () => null },
    eagleAssetProcessingJob: {
      updateMany: async () => {
        assert.fail('a job without completion evidence must not be completed');
      },
    },
  };

  assert.equal(await finishAlreadyAnalyzedAiTagJob(client, job), false);
});
