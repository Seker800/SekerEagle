import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setImmediate as flushQueryEvents } from 'node:timers/promises';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { EagleDuplicateService } from '../../apps/api/dist/eagle/eagle-duplicates.service.js';
import { EagleLibraryTransferService } from '../../apps/api/dist/eagle/eagle-library-transfer.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { OPERATION_METADATA_BATCH_SIZE } from '../../apps/api/dist/eagle/eagle-operation-settings.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
assert.equal(
  OPERATION_METADATA_BATCH_SIZE,
  32,
  'cost fixture measures the default metadata work target',
);
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const events = [];
const owners = [];
const objectCalls = [];
db.$on('query', ({ query, params }) => {
  events.push({ query, parameters: JSON.parse(params).length });
});
const report = {
  measuredAt: new Date().toISOString(),
  scope:
    'Real Nest domain service admission and independent executor tick/drain against isolated PostgreSQL; no HTTP server or token authentication',
  measured: [
    'domainAdmission',
    'executorTick',
    'domainProgressRead',
    'idleTick',
    'executorDrain',
    'SQL including transaction control',
    'BEGIN transactions',
    'S3 calls',
  ],
  unmeasured: [
    'HTTP and token authentication',
    'browser/desktop cache updates and refreshes',
    'physical object deletion',
    'production latency and disk IOPS',
  ],
  fixture: {
    metadataBatchItems: 32,
    ordinaryAssets: 500,
    duplicateGroups: 1000,
    assetsPerDuplicateGroup: 2,
    sharedTags: 0,
    liveComponents: 0,
    privateAssets: 0,
  },
  priorOrdinary500Baseline: null,
  ordinary500Comparison:
    'No prior same-fixture measurement exists. This work records current behavior; protocol extraction preserves the existing mutation and transaction lifecycle, and no SQL reduction is claimed.',
  prior32GroupReference: {
    PHOTO: { sql: 439, transactions: 2, s3: 0 },
    MATERIAL: { sql: 471, transactions: 2, s3: 0 },
    source: 'docs/background-processing-performance-2026-11-01.md',
    scope:
      'Existing metadata cleanup execution including claim; excludes HTTP admission and frontend',
  },
  operations: [],
};
function combine(costs) {
  return costs.reduce(
    (sum, cost) => ({
      sql: sum.sql + cost.sql,
      businessSql: sum.businessSql + cost.businessSql,
      transactions: sum.transactions + cost.transactions,
      s3: sum.s3 + cost.s3,
      milliseconds: sum.milliseconds + cost.milliseconds,
      maxParameters: Math.max(sum.maxParameters, cost.maxParameters),
    }),
    { sql: 0, businessSql: 0, transactions: 0, s3: 0, milliseconds: 0, maxParameters: 0 },
  );
}
async function measure(run) {
  await flushQueryEvents();
  const start = events.length,
    objects = objectCalls.length,
    clock = performance.now();
  const value = await run();
  await flushQueryEvents();
  const queries = events.slice(start);
  return {
    value,
    cost: {
      sql: queries.length,
      businessSql: queries.filter(({ query }) => !/^(?:BEGIN|COMMIT|ROLLBACK)/.test(query.trim()))
        .length,
      transactions: queries.filter(({ query }) => query.trim().startsWith('BEGIN')).length,
      s3: objectCalls.length - objects,
      milliseconds: performance.now() - clock,
      maxParameters: Math.max(0, ...queries.map(({ parameters }) => parameters)),
    },
  };
}
async function fixture(mode) {
  const ownerId = randomUUID();
  // Do not let a real tick claim leftover work from another fixture on this test database.
  assert.equal(
    await db.eagleAssetOperationItem.count({
      where: {
        libraryMode: mode,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    }),
    0,
    'cost test needs an idle synthetic operation lane; it never cancels or deletes another fixture',
  );
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  owners.push(ownerId);
  const principal = {
    sub: ownerId,
    authVersion: 0,
    canViewPrivate: false,
    privacyVisibleUntil: null,
    kind: 'browser',
    role: 'USER',
    email: 'synthetic@example.invalid',
    scopes: [],
  };
  const storage = Object.fromEntries(
    [
      'getObject',
      'headObject',
      'copyObject',
      'putObject',
      'deleteObject',
      'deleteObjects',
      'listObjects',
      'createMultipartUpload',
      'uploadPart',
      'completeMultipartUpload',
      'abortMultipartUpload',
    ].map((name) => [
      name,
      async () => {
        objectCalls.push(name);
        throw new Error('Metadata fixture must not access object storage');
      },
    ]),
  );
  const duplicates = new EagleDuplicateService(db, storage, mode);
  const createOperations = () =>
    new EagleAssetOperationService(
      db,
      new EagleLibraryTransferService(db, storage, mode),
      new EagleService(db, undefined, mode),
      mode,
      duplicates,
    );
  function asset(
    index,
    sha256 = createHash('sha256').update(`single-${index}`).digest('hex'),
    rating = null,
  ) {
    const id = randomUUID();
    return {
      id,
      ownerId,
      libraryMode: mode,
      originalName: `synthetic-${index}.jpg`,
      displayName: `Synthetic ${index}`,
      normalizedDisplayName: `synthetic ${index}`,
      format: 'jpeg',
      mimeType: 'image/jpeg',
      byteSize: 1000n,
      sha256,
      mediaRevision: 1,
      lifecycleStatus: 'READY',
      width: 1200,
      height: 800,
      rating,
      originalObjectKey: `users/${ownerId}/assets/${id}/original`,
    };
  }
  return {
    mode,
    ownerId,
    principal,
    duplicates,
    operations: createOperations(),
    createOperations,
    asset,
  };
}
async function seed(rows) {
  // Fixture setup is excluded from operation costs; batching prevents a wide seed statement.
  for (let offset = 0; offset < rows.length; offset += 500)
    await db.eagleAsset.createMany({ data: rows.slice(offset, offset + 500) });
}
async function execute(f, operationId, total, kind) {
  const batches = [],
    progress = [];
  let completed = 0;
  const expectedBatches = Math.ceil(total / OPERATION_METADATA_BATCH_SIZE);
  for (let index = 0; index < expectedBatches; index++) {
    const execution = await measure(() => f.operations.tick());
    const polling = await measure(() => f.operations.list(f.ownerId, false));
    const state = polling.value.find((operation) => operation.id === operationId);
    assert.ok(state);
    assert.equal(state.failed, 0);
    assert.equal(state.cancelled, 0);
    const processed = state.completed - completed;
    assert.equal(
      processed,
      Math.min(OPERATION_METADATA_BATCH_SIZE, total - completed),
      'one tick processes a full default batch or its final tail',
    );
    assert.equal(execution.cost.transactions, 2, 'one claim plus one atomic publication per tick');
    assert.equal(execution.cost.s3, 0);
    // This generous invariant catches a regression to per-item metadata execution.
    assert.ok(execution.cost.sql <= 128, `${kind} batch reverted to per-item SQL`);
    batches.push({ index, items: processed, ...execution.cost });
    progress.push(polling.cost);
    completed = state.completed;
  }
  assert.equal(completed, total);
  const idle = await measure(() => f.operations.tick());
  assert.equal(idle.cost.transactions, 0);
  assert.equal(
    idle.cost.sql,
    3,
    'idle lanes use three unlocked probes, without claim transactions',
  );
  const drain = await measure(() => f.operations.drain());
  assert.equal(drain.cost.sql, 0);
  const execution = combine(batches);
  assert.equal(execution.transactions, 2 * expectedBatches);
  const progressReads = combine(progress);
  return {
    batchCount: batches.length,
    batches,
    execution,
    progressReads,
    idleTick: idle.cost,
    drain: drain.cost,
    fullDrainIncludingProgressAndIdle: combine([execution, progressReads, idle.cost, drain.cost]),
  };
}
for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode}: record actual 500-resource trash and restore domain/executor costs`, async () => {
    const f = await fixture(mode);
    const rows = Array.from({ length: 500 }, (_, index) => f.asset(index));
    await seed(rows);
    for (const kind of ['TRASH', 'RESTORE']) {
      f.operations = f.createOperations();
      const admitted = await measure(() =>
        f.operations.enqueue(f.principal, {
          operationId: randomUUID(),
          kind,
          assetIds: rows.map(({ id }) => id),
        }),
      );
      assert.equal(admitted.value.total, 500);
      assert.ok(
        admitted.cost.sql <= 16,
        '500-resource admission must retain set-based preparation',
      );
      assert.equal(admitted.cost.transactions, 1);
      assert.equal(admitted.cost.s3, 0);
      const execution = await execute(f, admitted.value.id, 500, kind);
      const current = await db.eagleAsset.findMany({
        where: { ownerId: f.ownerId, libraryMode: mode },
        select: { id: true, deletedAt: true, purgeAfter: true, rowVersion: true },
      });
      assert.equal(current.length, 500);
      assert.equal(
        current.filter((row) => row.deletedAt !== null).length,
        kind === 'TRASH' ? 500 : 0,
      );
      assert.ok(
        current.every(
          (row) => row.purgeAfter === null && row.rowVersion === (kind === 'TRASH' ? 2 : 3),
        ),
      );
      report.operations.push({
        mode,
        kind,
        items: 500,
        admission: admitted.cost,
        ...execution,
        domainTotalIncludingProgressAndIdle: combine([
          admitted.cost,
          execution.fullDrainIncludingProgressAndIdle,
        ]),
      });
    }
  });
  test(`${mode}: record actual thousand-group cleanup and retain default full metadata batches`, async () => {
    const f = await fixture(mode);
    const keepers = [],
      removed = [];
    for (let index = 0; index < 1000; index++) {
      const sha256 = createHash('sha256').update(`group-${index}`).digest('hex');
      keepers.push(f.asset(`keeper-${index}`, sha256, 5));
      removed.push(f.asset(`remove-${index}`, sha256, 1));
    }
    await seed([...keepers, ...removed]);
    const review = await measure(() => f.duplicates.list(f.ownerId, false, {}));
    assert.equal(review.value.exactGroups, 1000);
    assert.equal(review.value.groups.length, 24, 'allExact must cover unloaded groups as well');
    const admitted = await measure(() =>
      f.duplicates.cleanup(f.principal, {
        operationId: randomUUID(),
        revision: review.value.exactRevision,
        allExact: true,
      }),
    );
    assert.ok(
      admitted.cost.sql <= 64,
      'thousand-group admission must amortize across database batches',
    );
    assert.equal(admitted.cost.transactions, 1);
    assert.equal(admitted.cost.s3, 0);
    const execution = await execute(f, admitted.value.operationId, 1000, 'DUPLICATE_CLEANUP');
    assert.equal(execution.batchCount, 32);
    assert.equal(execution.execution.transactions, 64);
    assert.deepEqual(
      execution.batches.map(({ items }) => items),
      [...Array(31).fill(32), 8],
    );
    assert.equal(
      await db.eagleAsset.count({
        where: {
          ownerId: f.ownerId,
          libraryMode: mode,
          id: { in: keepers.map(({ id }) => id) },
          deletedAt: null,
          rating: 5,
        },
      }),
      1000,
    );
    assert.equal(
      await db.eagleAsset.count({
        where: {
          ownerId: f.ownerId,
          libraryMode: mode,
          id: { in: removed.map(({ id }) => id) },
          deletedAt: { not: null },
          purgeAfter: null,
        },
      }),
      1000,
    );
    assert.equal(
      await db.eagleAssetOperationItem.count({
        where: { operationId: admitted.value.operationId, status: 'COMPLETED' },
      }),
      1000,
    );
    report.operations.push({
      mode,
      kind: 'DUPLICATE_CLEANUP',
      items: 1000,
      groups: 1000,
      review: review.cost,
      admission: admitted.cost,
      ...execution,
      domainTotalIncludingReviewProgressAndIdle: combine([
        review.cost,
        admitted.cost,
        execution.fullDrainIncludingProgressAndIdle,
      ]),
    });
  });
}
after(async () => {
  for (const ownerId of owners) {
    await db.eagleAssetOperation.deleteMany({ where: { ownerId } });
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.eagleObjectDeletion.deleteMany({ where: { ownerId } });
    await db.user.deleteMany({ where: { id: ownerId } });
  }
  await db.$disconnect();
  mkdirSync('.omx/artifacts', { recursive: true });
  writeFileSync('.omx/artifacts/operation-cost.json', JSON.stringify(report, null, 2) + '\n');
});
