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
      assetIds: [target.id],
      payload: {
        recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, exposure: 0.5 } },
        parts: { adjustments: true, filter: false, watermark: false, crop: false },
        preservedLuts: { 'lut:browser-upload': lut },
      },
    });
    await service.tick(false);
    const state = (await service.list(ownerId, true)).find((row) => row.id === op.id);
    assert.equal(state.state, 'COMPLETED');
    assert.equal(state.failed, 0);
    const render = await db.eagleEditRender.findFirstOrThrow({
      where: { ownerId },
      include: { job: true },
    });
    assert.equal(render.job.assetId, base.id);
    assert.equal(render.commandOperationId, op.id);
    assert.equal(render.lut, null);
    assert.equal(render.recipe.edits.filter, 'lut:browser-upload');
    assert.equal(render.recipe.edits.exposure, 0.5);
    assert.equal(await resolveEditRenderLut(db, render, 'lut:browser-upload'), lut);
    assert.equal(
      (await db.eagleAssetOperation.findUniqueOrThrow({ where: { id: op.id } })).commandPayload
        .preservedLuts['lut:browser-upload'],
      lut,
    );
  });
