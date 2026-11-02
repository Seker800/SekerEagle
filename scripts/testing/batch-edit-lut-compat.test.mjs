import { readBatchEditRenderContext } from '../../apps/api/dist/eagle/eagle-batch-edit.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { DEFAULT_PHOTO_EDITS } from '../../packages/library-core/dist/index.js';
import { writePortableLut } from '../../packages/photo-render-core/dist/portable-lut.js';
import { createAssetOperationExecutors } from '../../apps/api/dist/asset-operation-executor.js';
import { resolveEditRenderLut } from '../../apps/worker/dist/edit-render-lut.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ adapter: createPrismaAdapter() });
const owners = [];
after(async () => {
  for (const ownerId of owners) {
    await db.eagleAssetProcessingJob.deleteMany({ where: { ownerId } });
    await db.eagleAssetOperation.deleteMany({ where: { ownerId } });
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.user.delete({ where: { id: ownerId } });
  }
  await db.$disconnect();
});
const lut = writePortableLut({
  size: 2,
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
  data: new Float32Array(24),
});
const unusedLut = writePortableLut({
  size: 33,
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
  data: new Float32Array(33 ** 3 * 3),
});
for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode}: historical browser-upload recipe without render journal preserves its LUT during partial background paste`, async () => {
    const ownerId = randomUUID();
    owners.push(ownerId);
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
    });
    const add = () =>
      db.eagleAsset.create({
        data: {
          ownerId,
          libraryMode: mode,
          originalName: 'synthetic.jpg',
          displayName: 'Synthetic',
          normalizedDisplayName: 'synthetic',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${ownerId}/${randomUUID()}.jpg`,
          lifecycleStatus: 'READY',
          mediaRevision: 1,
        },
      });
    const base = await add();
    const target = await add();
    // This is the real persisted browser upload/editRecipe shape: an independent result links its immutable base,
    // while no server-side render journal exists for the already-uploaded browser bitmap.
    await db.eagleAssetEditRecipe.create({
      data: {
        ownerId,
        libraryMode: mode,
        assetId: target.id,
        assetRevision: target.mediaRevision,
        baseAssetId: base.id,
        baseMediaRevision: base.mediaRevision,
        recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:browser-upload' } },
      },
    });
    assert.equal(await db.eagleEditRender.count({ where: { ownerId } }), 0);
    // A saved draft uses the same recipe table but has no immutable-copy base.
    await db.eagleAssetEditRecipe.create({
      data: {
        ownerId,
        libraryMode: mode,
        assetId: base.id,
        assetRevision: base.mediaRevision,
        baseMediaRevision: base.mediaRevision,
        recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:browser-upload' } },
      },
    });
    assert.deepEqual(
      await readBatchEditRenderContext(db, ownerId, mode, [target.id, base.id], false),
      { preservedFilterIds: ['lut:browser-upload'] },
    );
    const hidden = await add();
    await db.eagleAsset.update({ where: { id: hidden.id }, data: { isPrivate: true } });
    await assert.rejects(
      readBatchEditRenderContext(db, ownerId, mode, [target.id, hidden.id], false),
      (error) => error.getStatus?.() === 404,
    );
    await assert.rejects(
      readBatchEditRenderContext(db, randomUUID(), mode, [target.id], false),
      (error) => error.getStatus?.() === 404,
    );
    const service = createAssetOperationExecutors(
      db,
      new Proxy(
        {},
        {
          get: () => () => {
            throw new Error('paste must enqueue original render jobs without object IO');
          },
        },
      ),
    )[mode === 'PHOTO' ? 1 : 0];
    const principal = {
      sub: ownerId,
      role: 'USER',
      email: 'synthetic@example.invalid',
      kind: 'browser',
      authVersion: 0,
      scopes: [],
      canViewPrivate: false,
      privacyVisibleUntil: null,
    };
    const op = await service.enqueueCommand(principal, {
      type: 'BATCH_EDIT_RENDER',
      assetIds: [target.id, base.id],
      payload: {
        recipe: {
          version: 1,
          edits: { ...DEFAULT_PHOTO_EDITS, exposure: 0.5, filter: 'lut:browser-upload' },
        },
        lut: unusedLut,
        parts: { adjustments: true, filter: false, watermark: false, crop: false },
        preservedLuts: { 'lut:browser-upload': lut, 'lut:unused-table': unusedLut },
      },
    });
    await service.tick(false);
    const state = (await service.list(ownerId, true)).find((row) => row.id === op.id);
    assert.equal(state.state, 'COMPLETED');
    assert.equal(state.failed, 0);
    const allRenders = await db.eagleEditRender.findMany({ where: { ownerId } });
    assert.equal(allRenders.length, 2);
    assert.ok(
      allRenders.every((row) => row.lut === null && row.commandOperationId === op.id),
      'each target references one shared operation table, including a historical draft',
    );
    const render = await db.eagleEditRender.findFirstOrThrow({
      where: { ownerId },
      include: { job: true },
    });
    assert.equal(render.job.assetId, base.id);
    assert.equal(render.commandOperationId, op.id);
    assert.equal(render.lut, null);
    assert.equal(render.recipe.edits.filter, 'lut:browser-upload');
    assert.equal(render.recipe.edits.exposure, 0.5);
    const projectedDb = {
      $queryRaw: async (query) => {
        const rows = await db.$queryRaw(query);
        assert.ok(
          JSON.stringify(rows).length < 5000,
          'unrelated multi-MB bank data must stay inside PostgreSQL',
        );
        return rows;
      },
    };
    assert.equal(
      await resolveEditRenderLut(projectedDb, render, 'lut:browser-upload'),
      lut,
      'unselected filter must ignore same-ID clipboard bytes',
    );
    await assert.rejects(
      resolveEditRenderLut(db, { ...render, ownerId: randomUUID() }, 'lut:browser-upload'),
      /EDIT_LUT_REFERENCE_MISSING/,
    );
    await assert.rejects(
      resolveEditRenderLut(
        db,
        { ...render, libraryMode: mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO' },
        'lut:browser-upload',
      ),
      /EDIT_LUT_REFERENCE_MISSING/,
    );
    await assert.rejects(
      resolveEditRenderLut(db, render, 'lut:absent'),
      /EDIT_LUT_REFERENCE_MISMATCH/,
    );
    assert.equal(
      (await db.eagleAssetOperation.findUniqueOrThrow({ where: { id: op.id } })).commandPayload
        .preservedLuts['lut:browser-upload'],
      lut,
    );
  });
