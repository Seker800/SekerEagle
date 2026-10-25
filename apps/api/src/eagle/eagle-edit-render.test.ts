import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditRender } from './eagle-edit-render';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import type { PrismaService } from '../prisma/prisma.service';
const input = {
  requestId: 'c904e831-b169-4cc5-a6ab-c008bc673e92',
  mediaRevision: 1,
  rowVersion: 3,
  recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
};
test('render requests derive owner and mode and conceal missing/private/cross-owner sources', async () => {
  let where: unknown;
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({
        $queryRaw: async () => [],
        eagleAsset: {
          findFirst: async (args: { where: unknown }) => {
            where = args.where;
            return null;
          },
        },
      }),
  } as unknown as PrismaService;
  await assert.rejects(
    createEditRender(db, 'owner', 'PHOTO', 'source', input, false),
    (reason: unknown) => (reason as { getStatus(): number }).getStatus() === 404,
  );
  assert.deepEqual(where, {
    id: 'source',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    deletedAt: null,
    purgeAfter: null,
    isPrivate: false,
  });
});
test('a stale revision or row version cannot enqueue an edit of newer contents', async () => {
  for (const source of [
    { mediaRevision: 2, rowVersion: 3 },
    { mediaRevision: 1, rowVersion: 4 },
  ]) {
    const db = {
      $transaction: async (run: (tx: unknown) => unknown) =>
        run({
          $queryRaw: async () => [],
          eagleAsset: {
            findFirst: async () => ({
              id: 'source',
              mimeType: 'image/jpeg',
              lifecycleStatus: 'READY',
              ...source,
            }),
          },
        }),
    } as unknown as PrismaService;
    await assert.rejects(
      createEditRender(db, 'owner', 'MATERIAL', 'source', input, false),
      (reason: unknown) => (reason as { getStatus(): number }).getStatus() === 409,
    );
  }
});

test('rejects missing LUT data and unsupported watermark templates before enqueueing', async () => {
  for (const edits of [{ filter: 'lut:missing' }, { watermark: 'unknown-template' }]) {
    await assert.rejects(
      createEditRender(
        {} as PrismaService,
        'owner',
        'PHOTO',
        'source',
        { ...input, recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, ...edits } } },
        false,
      ),
      (reason: unknown) => (reason as { getStatus(): number }).getStatus() === 400,
    );
  }
});
test('status reads scope both source and result and never expose raw failure/object keys', async () => {
  const { readEditRender } = await import('./eagle-edit-render');
  const queries: unknown[] = [];
  const source = { id: 'source', mediaRevision: 1, rowVersion: 3 };
  const db = {
    eagleAsset: {
      findFirst: async (args: unknown) => {
        queries.push(args);
        return queries.length === 1 ? source : null;
      },
    },
    eagleEditRender: {
      findFirst: async () => ({
        resultAssetId: 'copy',
        sourceRowVersion: 3,
        job: { status: 'COMPLETED', assetRevision: 1 },
      }),
    },
  } as unknown as PrismaService;
  await assert.rejects(
    readEditRender(db, 'owner', 'PHOTO', 'source', 'job', false),
    (reason: unknown) => (reason as { getStatus(): number }).getStatus() === 404,
  );
  assert.deepEqual(queries[1], {
    where: {
      id: 'copy',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    },
  });
  const failed = {
    eagleAsset: { findFirst: async () => source },
    eagleEditRender: {
      findFirst: async () => ({
        sourceRowVersion: 3,
        job: { status: 'FAILED', assetRevision: 1, lastError: 'secret-object-key' },
      }),
    },
  } as unknown as PrismaService;
  const status = await readEditRender(failed, 'owner', 'PHOTO', 'source', 'job', false);
  assert.equal(status.status, 'FAILED');
  assert.ok(!JSON.stringify(status).includes('secret'));
});

test('idempotency compares canonical intent independently of JSON field order', async () => {
  let existing: { jobId: string; job: { processorVersion: string } } | null = null;
  const tx = {
    $queryRaw: async () => [],
    eagleAsset: {
      findFirst: async () => ({ mimeType: 'image/jpeg', mediaRevision: 1, rowVersion: 3 }),
    },
    eagleEditRender: { findUnique: async () => existing },
    eagleAssetProcessingJob: {
      create: async ({ data }: { data: { id: string; processorVersion: string } }) => {
        existing = { jobId: data.id, job: { processorVersion: data.processorVersion } };
      },
    },
  };
  const db = {
    $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
  } as unknown as PrismaService;
  const first = await createEditRender(db, 'owner', 'PHOTO', 'source', input, false);
  const reordered = {
    recipe: input.recipe,
    rowVersion: input.rowVersion,
    mediaRevision: input.mediaRevision,
    requestId: input.requestId,
  };
  assert.deepEqual(await createEditRender(db, 'owner', 'PHOTO', 'source', reordered, false), first);
});
