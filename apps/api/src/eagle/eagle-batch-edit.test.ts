import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { writePortableLut } from '@sekereagle/photo-render-core/portable-lut';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { registerBatchEditCommands } from './eagle-batch-edit';
import { LibraryCommandRegistry, type LibraryCommandContext } from './eagle-library-command';

const context: LibraryCommandContext = {
  ownerId: 'owner',
  libraryMode: 'PHOTO',
  operationId: 'ac9c9a79-a743-445a-b8d8-156e0c1bc201',
  includePrivate: false,
  beforePublish: async () => undefined,
};
const parts = { adjustments: true, filter: false, watermark: false, crop: false };
const recipe = { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, exposure: 0.8 } };
const portableLut = writePortableLut({
  size: 2,
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
  data: new Float32Array(24),
});
function harness(
  storedEdits = { ...DEFAULT_PHOTO_EDITS, cropX: 0.25 },
  rows?: Array<Record<string, unknown>>,
) {
  const assets = rows ?? [
    {
      id: 'copy',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      mediaRevision: 2,
      rowVersion: 4,
      mimeType: 'image/jpeg',
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    },
    {
      id: 'base',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      mediaRevision: 1,
      rowVersion: 3,
      mimeType: 'image/jpeg',
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    },
  ];
  const jobs: Array<{ data: Record<string, unknown> }> = [];
  const requests = new Map<string, { jobId: unknown; job: { processorVersion: unknown } }>();
  const queries: Array<Record<string, unknown>> = [];
  const lutQueries: unknown[] = [];
  const tx = {
    $queryRaw: async () => [],
    eagleAsset: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        queries.push(where);
        return (
          assets.find((asset) =>
            Object.entries(where).every(([key, value]) => asset[key] === value),
          ) ?? null
        );
      },
    },
    eagleAssetEditRecipe: {
      findFirst: async () => ({
        assetRevision: 2,
        baseAssetId: 'base',
        baseMediaRevision: 1,
        recipe: { version: 1, edits: storedEdits },
      }),
    },
    eagleEditRender: {
      findUnique: async ({
        where,
      }: {
        where: { ownerId_libraryMode_requestId: { requestId: string } };
      }) => requests.get(where.ownerId_libraryMode_requestId.requestId) ?? null,
      findFirst: async (query: unknown) => {
        lutQueries.push(query);
        return { lut: portableLut };
      },
    },
    eagleAssetProcessingJob: {
      create: async (input: { data: Record<string, unknown> }) => {
        jobs.push(input);
        const edit = input.data.editRender as { create: { requestId: string } };
        requests.set(edit.create.requestId, {
          jobId: input.data.id,
          job: { processorVersion: input.data.processorVersion },
        });
      },
    },
  };
  const registry = new LibraryCommandRegistry();
  registerBatchEditCommands(registry, {} as never);
  const definition = registry.get('BATCH_EDIT_RENDER');
  if (definition.protocol !== 'METADATA') throw new Error('wrong protocol');
  return { definition, tx, jobs, queries, lutQueries };
}

test('batch edit renders from immutable base, preserves unselected parts, and resumes idempotently', async () => {
  const { definition, tx, jobs } = harness();
  const payload = { recipe, parts };
  await definition.apply(tx as never, context, payload, ['copy']);
  await definition.apply(tx as never, context, payload, ['copy']);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.data.assetId, 'base');
  assert.equal(jobs[0]!.data.assetRevision, 1);
  const edit = jobs[0]!.data.editRender as {
    create: { recipe: { edits: typeof DEFAULT_PHOTO_EDITS } };
  };
  assert.equal(edit.create.recipe.edits.exposure, 0.8);
  assert.equal(edit.create.recipe.edits.cropX, 0.25);
  assert.equal(edit.create.recipe.edits.filter, DEFAULT_PHOTO_EDITS.filter);
});

test('batch edit hides cross-owner, wrong-mode, private, deleted and retired target resources', async () => {
  for (const overrides of [
    { ownerId: 'other' },
    { libraryMode: 'MATERIAL' },
    { isPrivate: true },
    { deletedAt: new Date() },
    { purgeAfter: new Date() },
  ]) {
    const { definition, tx, jobs, queries } = harness(DEFAULT_PHOTO_EDITS, [
      {
        id: 'copy',
        ownerId: 'owner',
        libraryMode: 'PHOTO',
        deletedAt: null,
        purgeAfter: null,
        isPrivate: false,
        ...overrides,
      },
    ]);
    await assert.rejects(
      definition.apply(tx as never, context, { recipe, parts }, ['copy']),
      NotFoundException,
    );
    assert.equal(jobs.length, 0);
    assert.deepEqual(queries[0], {
      id: 'copy',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    });
  }
});

test('batch edit rejects malformed portable LUT data without creating media jobs', async () => {
  const { definition, tx, jobs } = harness();
  await assert.rejects(
    definition.apply(
      tx as never,
      context,
      {
        recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:bad' } },
        parts: { ...parts, filter: true },
        lut: 'https://external.invalid/filter.cube',
      },
      ['copy'],
    ),
    BadRequestException,
  );
  assert.equal(jobs.length, 0);
});

test('adjustment-only paste preserves the target custom LUT instead of taking clipboard data', async () => {
  const { definition, tx, jobs, lutQueries } = harness({
    ...DEFAULT_PHOTO_EDITS,
    filter: 'lut:target',
  });
  await definition.apply(
    tx as never,
    context,
    { recipe, parts, lut: 'clipboard must be ignored' },
    ['copy'],
  );
  const edit = jobs[0]!.data.editRender as {
    create: { lut: string; recipe: { edits: typeof DEFAULT_PHOTO_EDITS } };
  };
  assert.equal(edit.create.lut, portableLut);
  assert.equal(edit.create.recipe.edits.filter, 'lut:target');
  assert.deepEqual(lutQueries, [
    {
      where: {
        ownerId: 'owner',
        libraryMode: 'PHOTO',
        resultAssetId: 'copy',
        recipe: { path: ['edits', 'filter'], equals: 'lut:target' },
        job: { status: 'COMPLETED' },
      },
      select: { lut: true },
    },
  ]);
});

test('selected portable LUT is referenced from the immutable operation instead of copied into every render job', async () => {
  const { definition, tx, jobs } = harness();
  await definition.apply(tx as never, context, { recipe: { version: 1,
    edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:clipboard' } }, parts: { ...parts, filter: true }, lut: portableLut }, ['copy']);
  const edit = jobs[0]!.data.editRender as { create: { lut?: string; commandOperationId?: string } };
  assert.equal(edit.create.commandOperationId, context.operationId);
  assert.equal(edit.create.lut, undefined);
});
