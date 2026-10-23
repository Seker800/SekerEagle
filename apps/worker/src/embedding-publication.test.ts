import assert from 'node:assert/strict';
import test from 'node:test';
import { publishEmbedding } from './embedding-publication';

const job = {
  id: 'job-1',
  ownerId: 'owner-1',
  libraryMode: 'PHOTO' as const,
  assetId: 'asset-1',
  assetRevision: 2,
  leaseVersion: 3,
};

function fixture(leaseCount = 1, recordCount = 1, currentRevision = true) {
  const calls: Array<{ operation: string; input: unknown }> = [];
  let options: { timeout?: number; maxWait?: number } | undefined;
  const tx = {
    $queryRaw: async () => (currentRevision ? [{ id: job.assetId }] : []),
    eagleAssetProcessingJob: {
      updateMany: async (input: unknown) => {
        calls.push({ operation: 'lease', input });
        return { count: leaseCount };
      },
    },
    eagleAssetEmbedding: {
      updateMany: async (input: { data: { status?: string } }) => {
        calls.push({ operation: 'embedding', input });
        return { count: input.data.status === 'READY' ? recordCount : 1 };
      },
    },
    $executeRaw: async (input: unknown) => {
      // Reproduce a six-second NAS index write without sleeping in the test.
      assert.ok((options?.timeout ?? 5000) > 6000, 'NAS index write exceeds Prisma default');
      assert.ok(options!.timeout! <= 60000, 'transaction must remain bounded');
      calls.push({ operation: 'vector', input });
      return 1;
    },
  };
  const client = {
    $transaction: async (work: (value: typeof tx) => Promise<void>, supplied?: typeof options) => {
      options = supplied;
      return work(tx);
    },
  };
  const suggest = async (...input: unknown[]) => {
    calls.push({ operation: 'suggest', input });
  };
  return { client, suggest, calls };
}

test('publishes a vector and job atomically with a bounded NAS index-write budget', async () => {
  const f = fixture();
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], f.suggest);
  assert.deepEqual(
    f.calls.map((x) => x.operation),
    ['lease', 'embedding', 'embedding', 'vector', 'vector', 'suggest'],
  );
  assert.deepEqual((f.calls[0]!.input as { where: unknown }).where, {
    id: job.id,
    ownerId: job.ownerId,
    libraryMode: job.libraryMode,
    assetId: job.assetId,
    assetRevision: job.assetRevision,
    status: 'PROCESSING',
    leaseVersion: job.leaseVersion,
  });
  const vector = f.calls[3]!.input as { values: unknown[] };
  assert.deepEqual(vector.values, ['[1,0]', job.ownerId, job.libraryMode, 'vector-1']);
});

test('a lost lease cannot publish a vector or generate suggestions', async () => {
  const f = fixture(0);
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], f.suggest);
  assert.deepEqual(
    f.calls.map((x) => x.operation),
    ['lease'],
  );
});

test('a missing or differently scoped vector record aborts publication', async () => {
  const f = fixture(1, 0);
  await assert.rejects(
    publishEmbedding(f.client as never, job, 'vector-1', [1, 0], f.suggest),
    /EMBEDDING_RECORD_NOT_OWNED/,
  );
  assert.equal(
    f.calls.some((x) => x.operation === 'vector' || x.operation === 'suggest'),
    false,
  );
  assert.deepEqual((f.calls[2]!.input as { where: unknown }).where, {
    id: 'vector-1',
    ownerId: job.ownerId,
    libraryMode: job.libraryMode,
    assetId: job.assetId,
    assetRevision: job.assetRevision,
  });
});

test('a superseded media revision cannot publish into smart folders', async () => {
  const f = fixture(1, 1, false);
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], f.suggest);
  assert.deepEqual(f.calls, []);
});
