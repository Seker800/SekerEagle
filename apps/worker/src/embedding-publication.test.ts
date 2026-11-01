import assert from 'node:assert/strict';
import test from 'node:test';
import { publishEmbedding, publishStoredEmbedding } from './embedding-publication';

const identity = {
  id: 'space',
  model: 'model',
  revision: 'revision',
  dimensions: 2,
  normalized: true,
  instructionVersion: 'image-retrieval-v1',
  preprocessingVersion: 'preview-webp-v1',
};

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
    $queryRaw: async () => (currentRevision ? [{ id: job.assetId, spaceId: identity.id }] : []),
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
      return (input as { sql: string }).sql.includes('UPDATE "EagleAssetEmbedding"')
        ? recordCount
        : 1;
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
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], identity, f.suggest);
  assert.deepEqual(
    f.calls.map((x) => x.operation),
    ['lease', 'embedding', 'vector', 'vector', 'suggest'],
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
  const vector = f.calls[2]!.input as { values: unknown[] };
  assert.deepEqual(vector.values, [
    '[1,0]',
    'vector-1',
    job.ownerId,
    job.libraryMode,
    job.assetId,
    job.assetRevision,
    identity.id,
  ]);
});

test('a lost lease cannot publish a vector or generate suggestions', async () => {
  const f = fixture(0);
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], identity, f.suggest);
  assert.deepEqual(
    f.calls.map((x) => x.operation),
    ['lease'],
  );
});

test('a missing or differently scoped vector record aborts publication', async () => {
  const f = fixture(1, 0);
  await assert.rejects(
    publishEmbedding(f.client as never, job, 'vector-1', [1, 0], identity, f.suggest),
    /EMBEDDING_RECORD_NOT_OWNED/,
  );
  assert.equal(
    f.calls.some((x) => x.operation === 'suggest'),
    false,
  );
  const write = f.calls[2]!.input as { values: unknown[] };
  assert.ok(write.values.includes(job.ownerId));
  assert.ok(write.values.includes(job.libraryMode));
  assert.ok(write.values.includes(job.assetRevision));
  assert.ok(write.values.includes(identity.id));
});

test('a superseded media revision cannot publish into smart folders', async () => {
  const f = fixture(1, 1, false);
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], identity, f.suggest);
  assert.deepEqual(f.calls, []);
});

test('stored-vector activation preserves compatibility, scope and lease without re-inference', async () => {
  const sql: string[] = [];
  let suggestions = 0;
  const identity = {
    id: 'space',
    model: 'model',
    revision: 'revision',
    dimensions: 1024,
    normalized: true,
    instructionVersion: 'image-retrieval-v1',
    preprocessingVersion: 'preview-webp-v1',
  };
  const tx = {
    $queryRaw: async (query: { sql: string }) => {
      sql.push(query.sql);
      if (query.sql.includes('FROM "EagleAsset"'))
        return [{ id: job.assetId, spaceId: identity.id }];
      return [{ id: 'stored', status: 'PENDING', isCurrent: false }];
    },
    eagleAssetProcessingJob: { updateMany: async () => ({ count: 1 }) },
    eagleAssetEmbedding: { updateMany: async () => ({ count: 1 }) },
    $executeRaw: async (query: { sql: string }) => {
      sql.push(query.sql);
      return 1;
    },
  };
  const reused = await publishStoredEmbedding(
    { $transaction: async (work: (tx: unknown) => Promise<boolean>) => work(tx) } as never,
    job,
    identity,
    async () => {
      suggestions++;
    },
  );
  assert.equal(reused, true);
  assert.equal(suggestions, 1);
  const lookup = sql[0]!;
  for (const field of [
    '"ownerId"',
    '"libraryMode"',
    '"assetRevision"',
    '"isCurrent"',
    'revision',
    '"preprocessingVersion"',
    '"instructionVersion"',
    'dimensions',
    'normalized',
  ])
    assert.ok(sql.join('\n').includes(field), field);
  assert.ok(sql[0]!.includes('"deletedAt" IS NULL'));
  const storedLookup = sql.find((query) => query.includes('FROM "EagleAssetEmbedding"'))!;
  assert.ok(storedLookup.includes('NOT e."isCurrent"'));
  assert.ok(storedLookup.includes("e.status IN ('PENDING','RUNNING','FAILED')"));
});

for (const scenario of [
  'no-cache',
  'stale-asset',
  'lost-lease',
  'ready',
  'missing-record',
] as const)
  test(`stored activation handles ${scenario} without unsafe publication`, async () => {
    let matched = 0;
    let completions = 0;
    const tx = {
      $queryRaw: async (query: { sql: string }) =>
        query.sql.includes('FROM "EagleAsset"')
          ? scenario === 'stale-asset'
            ? []
            : [{ id: job.assetId, spaceId: identity.id }]
          : scenario === 'no-cache' || scenario === 'ready'
            ? []
            : [
                {
                  id: 'stored',
                  status: 'FAILED',
                  isCurrent: false,
                },
              ],
      eagleAssetProcessingJob: {
        updateMany: async () => {
          completions++;
          return { count: scenario === 'lost-lease' ? 0 : 1 };
        },
      },
      eagleAssetEmbedding: {
        updateMany: async (input: { data: { status: string } }) => ({
          count: scenario === 'missing-record' && input.data.status === 'READY' ? 0 : 1,
        }),
      },
      $executeRaw: async () => {
        matched++;
        return 1;
      },
    };
    const client = { $transaction: async (work: (tx: unknown) => Promise<boolean>) => work(tx) };
    const identity = {
      id: 'space',
      model: 'model',
      revision: 'revision',
      dimensions: 1024,
      normalized: true,
      instructionVersion: 'image-retrieval-v1',
      preprocessingVersion: 'preview-webp-v1',
    };
    const activate = () =>
      publishStoredEmbedding(client as never, job, identity, async () => {
        matched++;
      });
    if (scenario === 'missing-record') await assert.rejects(activate, /EMBEDDING_RECORD_NOT_OWNED/);
    else assert.equal(await activate(), scenario !== 'no-cache' && scenario !== 'ready');
    assert.equal(completions, scenario === 'no-cache' || scenario === 'ready' ? 0 : 1);
    assert.equal(matched, 0);
  });

test('fresh publication locks the active model identity instead of trusting preparation', async () => {
  const queries: string[] = [];
  const f = fixture();
  const client = {
    $transaction: (work: (tx: unknown) => Promise<void>, options: unknown) =>
      f.client.$transaction(async (tx) => {
        const originalQuery = tx.$queryRaw;
        tx.$queryRaw = async (query?: unknown) => {
          queries.push((query as { sql: string }).sql);
          return originalQuery();
        };
        return work(tx);
      }, options as never),
  };
  await publishEmbedding(client as never, job, 'vector-1', [1, 0], identity, f.suggest);
  assert.ok(queries.some((sql) => sql.includes('"EagleEmbeddingSpace"')));
});

test('fresh publication writes vector bytes and READY state together', async () => {
  const f = fixture();
  await publishEmbedding(f.client as never, job, 'vector-1', [1, 0], identity, f.suggest);
  const writes = f.calls.filter((call) => call.operation === 'vector');
  assert.ok(
    writes.some((call) => {
      const sql = (call.input as { sql: string }).sql;
      return sql.includes('embedding=') && sql.includes("'READY'");
    }),
  );
});

test('malformed inference results fail before consuming a lease or publishing other outputs', async () => {
  for (const vector of [[1], [NaN, 0], [0, 0], [2, 0]]) {
    const f = fixture();
    await assert.rejects(
      publishEmbedding(f.client as never, job, 'vector-1', vector, identity, f.suggest),
      /EMBEDDING_RESULT_INVALID/,
    );
    assert.deepEqual(f.calls, []);
  }
});

test('a switched model cannot be published by a still-running old worker', async () => {
  const f = fixture();
  const client = {
    $transaction: (work: (tx: unknown) => Promise<void>, options: unknown) =>
      f.client.$transaction(async (tx) => {
        tx.$queryRaw = async () => [{ id: job.assetId, spaceId: 'new-space' }];
        return work(tx);
      }, options as never),
  };
  await assert.rejects(
    publishEmbedding(client as never, job, 'vector-1', [1, 0], identity, f.suggest),
    /EMBEDDING_SPACE_INCOMPATIBLE/,
  );
  assert.deepEqual(f.calls, []);
});

test('stored identity mismatch is an unavailable cache fact and leaves inference fallback possible', async () => {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async () => [{ id: job.assetId, spaceId: null }],
    eagleAssetProcessingJob: { updateMany: async () => { calls.push('complete'); return { count: 1 }; } },
  };
  assert.equal(await publishStoredEmbedding({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    job, identity, async () => { calls.push('suggest'); }), false);
  assert.deepEqual(calls, []);
});
