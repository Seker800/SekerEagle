import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleProcessingService } from './eagle-processing.service';

test('reconciler creates only missing current-version color jobs', async () => {
  const created: unknown[] = [];
  const service = new EagleProcessingService({
    eagleAsset: {
      findMany: async () => [
        { id: 'asset-1', ownerId: 'owner-1', mediaRevision: 1, width: 100, height: 100 },
        { id: 'asset-2', ownerId: 'owner-1', mediaRevision: 3, width: 100, height: 100 },
      ],
    },
    eagleAssetProcessingJob: {
      findMany: async () => [
        {
          id: 'color-job-1',
          assetId: 'asset-1',
          assetRevision: 1,
          kind: 'EXTRACT_COLOR_PALETTE',
          processorVersion: 'color-v3-thumbnail',
        },
        {
          id: 'rendition-job-1',
          assetId: 'asset-1',
          assetRevision: 1,
          kind: 'GENERATE_RENDITIONS',
          processorVersion: 'rendition-v2',
        },
        {
          id: 'rendition-job-2',
          assetId: 'asset-2',
          assetRevision: 3,
          kind: 'GENERATE_RENDITIONS',
          processorVersion: 'rendition-v2',
        },
      ],
      createMany: async ({ data }: { data: unknown[] }) => {
        created.push(...data);
        return { count: data.length };
      },
    },
  } as never);

  const result = await service.reconcile('owner-1');

  assert.deepEqual(result, { scanned: 2, created: 3, skipped: 0, remaining: 0 });
  const paletteJob = created.find(
    (job) => (job as { kind?: string }).kind === 'EXTRACT_COLOR_PALETTE',
  );
  assert.ok(paletteJob);
  assert.equal(typeof (paletteJob as { id: unknown }).id, 'string');
  const createdJob = { ...(paletteJob as Record<string, unknown>) };
  delete createdJob.id;
  assert.deepEqual(createdJob, {
    ownerId: 'owner-1',
    assetId: 'asset-2',
    assetRevision: 3,
    kind: 'EXTRACT_COLOR_PALETTE',
    lane: 'BACKGROUND',
    processorVersion: 'color-v3-thumbnail',
    dependsOnJobId: 'rendition-job-2',
  });
  assert.equal(
    created.filter((job) => (job as { kind?: string }).kind === 'GENERATE_EMBEDDING').length,
    2,
  );
});

test('reconciler scans beyond the first page without exceeding its creation bound', async () => {
  const assets = Array.from({ length: 501 }, (_, index) => ({
    id: `asset-${String(index).padStart(3, '0')}`,
    ownerId: 'owner-1',
    mediaRevision: 1,
    width: 100,
    height: 100,
  }));
  let page = 0;
  const service = new EagleProcessingService({
    eagleAsset: {
      findMany: async () => (page++ === 0 ? assets.slice(0, 500) : assets.slice(500)),
    },
    eagleAssetProcessingJob: {
      findMany: async () => [],
      createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }),
    },
  } as never);

  const result = await service.reconcile('owner-1');

  assert.deepEqual(result, { scanned: 501, created: 500, skipped: 0, remaining: 1003 });
  assert.equal(page, 2);
});

test('retrying a required media task restores the current asset processing lifecycle', async () => {
  const assetWrites: unknown[] = [];
  const transaction = {
    eagleAssetProcessingJob: {
      findFirst: async () => ({
        id: 'job-1',
        assetId: 'asset-1',
        assetRevision: 4,
        kind: 'GENERATE_RENDITIONS',
      }),
      updateMany: async () => ({ count: 1 }),
    },
    eagleAsset: {
      updateMany: async (input: unknown) => {
        assetWrites.push(input);
        return { count: 1 };
      },
    },
  };
  const service = new EagleProcessingService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  assert.deepEqual(await service.retry('owner-1', 'job-1'), { retried: 1 });
  assert.deepEqual(assetWrites[0], {
    where: {
      ownerId: 'owner-1',
      id: 'asset-1',
      mediaRevision: 4,
      deletedAt: null,
    },
    data: { lifecycleStatus: 'PROCESSING', mediaErrorCode: null },
  });
});
