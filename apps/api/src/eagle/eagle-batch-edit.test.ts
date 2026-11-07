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
  const originalLut: { lut: string | null; commandOperationId: string | null } = {
    lut: portableLut,
    commandOperationId: null,
  };
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
        return originalLut;
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
  return { definition, tx, jobs, queries, lutQueries, originalLut };
}

test('batch crop parts carry straighten while an unselected crop keeps the target angle', async () => {
  const stored = { ...DEFAULT_PHOTO_EDITS, cropX: 0.25, straighten: 2.5 };
  const cropRecipe = {
    version: 1 as const,
    edits: { ...DEFAULT_PHOTO_EDITS, rotation: 90, straighten: -7.4 },
  };
  for (const [crop, expected] of [
    [true, -7.4],
    [false, 2.5],
  ] as const) {
    const { definition, tx, jobs } = harness(stored);
    await definition.apply(
      tx as never,
      context,
      { recipe: cropRecipe, parts: { ...parts, crop } },
      ['copy'],
    );
    const edit = jobs[0]!.data.editRender as {
      create: { recipe: { edits: typeof DEFAULT_PHOTO_EDITS } };
    };
    assert.equal(edit.create.recipe.edits.straighten, expected);
  }
});

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
  const { definition, jobs } = harness();
  await assert.rejects(
    Promise.resolve().then(() =>
      definition.admit!(
        context,
        {
          recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:bad' } },
          parts: { ...parts, filter: true },
          lut: 'https://external.invalid/filter.cube',
        },
        ['copy'],
      ),
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
      select: { lut: true, commandOperationId: true },
    },
  ]);
});

test('selected portable LUT is referenced from the immutable operation instead of copied into every render job', async () => {
  const { definition, tx, jobs } = harness();
  await definition.apply(
    tx as never,
    context,
    {
      recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:clipboard' } },
      parts: { ...parts, filter: true },
      lut: portableLut,
    },
    ['copy'],
  );
  const edit = jobs[0]!.data.editRender as {
    create: { lut?: string; commandOperationId?: string };
  };
  assert.equal(edit.create.commandOperationId, context.operationId);
  assert.equal(edit.create.lut, undefined);
});

test('partial paste reuses the target render original shared LUT reference', async () => {
  const { definition, tx, jobs, originalLut } = harness({
    ...DEFAULT_PHOTO_EDITS,
    filter: 'lut:target',
  });
  originalLut.lut = null;
  originalLut.commandOperationId = 'original-operation';
  await definition.apply(tx as never, context, { recipe, parts }, ['copy']);
  const edit = jobs[0]!.data.editRender as {
    create: { lut?: string; commandOperationId?: string };
  };
  assert.equal(edit.create.commandOperationId, 'original-operation');
  assert.equal(edit.create.lut, undefined);
});

test('partial paste preserves custom LUT from a historical browser-uploaded edit recipe without a render journal', async () => {
  const { definition, tx, jobs } = harness({
    ...DEFAULT_PHOTO_EDITS,
    filter: 'lut:browser-upload',
  });
  Object.assign(tx.eagleEditRender, { findFirst: async () => null });
  await definition.apply(
    tx as never,
    context,
    { recipe, parts, preservedLuts: { 'lut:browser-upload': portableLut } },
    ['copy'],
  );
  const edit = jobs[0]!.data.editRender as {
    create: {
      commandOperationId?: string;
      lut?: string;
      recipe: { edits: typeof DEFAULT_PHOTO_EDITS };
    };
  };
  assert.equal(edit.create.recipe.edits.filter, 'lut:browser-upload');
  assert.equal(edit.create.commandOperationId, context.operationId);
  assert.equal(
    edit.create.lut,
    undefined,
    'fallback numeric tables are shared once by the operation',
  );
});

test('preserved filter banks validate every table and cannot replace the selected clipboard filter', async () => {
  const { definition, tx, jobs } = harness({ ...DEFAULT_PHOTO_EDITS, filter: 'lut:target' });
  for (const preservedLuts of [
    { 'lut:target': 'https://outside.invalid/filter.cube' },
    { builtin: portableLut },
    { 'lut:target': 8 },
  ])
    await assert.rejects(
      async () => definition.admit!(context, { recipe, parts, preservedLuts }, ['copy']),
      BadRequestException,
    );
  await definition.apply(
    tx as never,
    context,
    {
      recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: DEFAULT_PHOTO_EDITS.filter } },
      parts: { ...parts, filter: true },
      preservedLuts: { 'lut:target': portableLut },
    },
    ['copy'],
  );
  const edit = jobs[0]!.data.editRender as {
    create: { recipe: { edits: typeof DEFAULT_PHOTO_EDITS }; commandOperationId?: string };
  };
  assert.equal(edit.create.recipe.edits.filter, DEFAULT_PHOTO_EDITS.filter);
  assert.equal(edit.create.commandOperationId, undefined);
});

test('batch context returns only deduplicated unresolved current target filters with owner/private scope', async () => {
  const { readBatchEditRenderContext } = await import('./eagle-batch-edit');
  const queries: unknown[] = [];
  const db = {
    eagleAsset: {
      findMany: async (query: unknown) => {
        queries.push(query);
        return [
          { id: 'first', mediaRevision: 1 },
          { id: 'second', mediaRevision: 1 },
          { id: 'durable', mediaRevision: 1 },
          { id: 'stale', mediaRevision: 2 },
        ];
      },
    },
    eagleAssetEditRecipe: {
      findMany: async () =>
        ['first', 'second', 'durable', 'stale'].map((assetId) => ({
          assetId,
          assetRevision: 1,
          recipe: {
            version: 1,
            edits: {
              ...DEFAULT_PHOTO_EDITS,
              filter: assetId === 'durable' ? 'lut:saved' : 'lut:missing',
            },
          },
        })),
    },
    eagleEditRender: {
      findMany: async () => [
        {
          resultAssetId: 'durable',
          lut: null,
          commandOperationId: 'old-operation',
          recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:saved' } },
        },
      ],
    },
  };
  assert.deepEqual(
    await readBatchEditRenderContext(
      db as never,
      'owner',
      'PHOTO',
      ['first', 'second', 'durable', 'stale'],
      false,
    ),
    { preservedFilterIds: ['lut:missing'] },
  );
  assert.deepEqual(queries[0], {
    where: {
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      id: { in: ['first', 'second', 'durable', 'stale'] },
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    },
    select: { id: true, mediaRevision: true },
  });
  Object.assign(db.eagleAsset, { findMany: async () => [] });
  await assert.rejects(
    readBatchEditRenderContext(db as never, 'owner', 'PHOTO', ['foreign'], false),
    NotFoundException,
  );
});

test('batch context uses bounded set reads for the whole selection and never materializes numeric LUT bytes', async () => {
  const { readBatchEditRenderContext } = await import('./eagle-batch-edit');
  const assetSizes: number[] = [];
  const renderReads: Array<{ select: Record<string, unknown> }> = [];
  const db = {
    eagleAsset: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        assetSizes.push(where.id.in.length);
        return where.id.in.map((id) => ({ id, mediaRevision: 1 }));
      },
    },
    eagleAssetEditRecipe: {
      findMany: async ({ where }: { where: { assetId: { in: string[] } } }) =>
        where.assetId.in.map((assetId) => ({
          assetId,
          assetRevision: 1,
          recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:shared-local' } },
        })),
    },
    eagleEditRender: {
      findMany: async (query: { select: Record<string, unknown> }) => {
        renderReads.push(query);
        return [];
      },
    },
  };
  assert.deepEqual(
    await readBatchEditRenderContext(
      db as never,
      'owner',
      'MATERIAL',
      Array.from({ length: 1201 }, (_, i) => `asset-${i}`),
      false,
    ),
    { preservedFilterIds: ['lut:shared-local'] },
  );
  assert.equal(
    assetSizes.reduce((sum, n) => sum + n, 0),
    1201,
  );
  assert.ok(Math.max(...assetSizes) <= 512);
  assert.equal(renderReads.length, assetSizes.length);
  for (const query of renderReads)
    assert.deepEqual(query.select, { resultAssetId: true, recipe: true });
});
