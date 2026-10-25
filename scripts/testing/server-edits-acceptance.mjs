import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { decode } from 'fast-png';
import { parsePngLut } from '../../packages/photo-render-core/dist/photo-lut.js';
import { log } from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { DEFAULT_PHOTO_EDITS } from '../../packages/library-core/dist/index.js';
import { renderServerPhoto } from '../../packages/photo-render-core/dist/server-render.js';
import { writePortableLut } from '../../packages/photo-render-core/dist/portable-lut.js';

/** Runs only in the isolated HTTP workbench; never imports credentials or targets a persistent lab. */
export async function verifyServerEdits({
  api,
  upload,
  db,
  storage,
  bucket,
  origin,
  accessToken,
  ownerId,
}) {
  const bytes = await sharp({
    create: { width: 2560, height: 1920, channels: 3, background: '#677b98' },
  })
    .jpeg()
    .toBuffer();
  const created = await upload('photos', bytes, 'server-edit-synthetic.jpg');
  const before = await db.eagleAsset.findUniqueOrThrow({ where: { id: created.assetId } });
  const source = await api(`/photos/assets/${created.assetId}`);
  const recipe = {
    version: 1,
    edits: {
      ...DEFAULT_PHOTO_EDITS,
      watermark: 'photo-strip',
      watermarkCamera: 'Synthetic Camera',
      watermarkParameters: '26mm · f/2',
      cropRatio: '1:1',
      exposure: 15,
    },
  };
  const input = {
    requestId: randomUUID(),
    mediaRevision: source.mediaRevision,
    rowVersion: source.rowVersion,
    recipe,
  };
  async function rejected(path, body, status, headers = {}) {
    const response = await fetch(`${origin}/api${path}`, {
      method: 'POST',
      headers: {
        cookie: `sekereagle_access=${accessToken}`,
        origin,
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
  const path = `/photos/assets/${source.id}/edit-renders`;
  await rejected(path, { ...input, ownerId: randomUUID() }, 400);
  await rejected(path, input, 403, { origin: 'https://untrusted.invalid' });
  await rejected(`/eagle/assets/${source.id}/edit-renders`, input, 404);
  await rejected(path, { ...input, rowVersion: source.rowVersion + 1 }, 409);
  const other = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  const foreign = await db.eagleAsset.create({
    data: {
      ownerId: other.id,
      libraryMode: 'PHOTO',
      originalName: 'hidden.png',
      displayName: 'hidden',
      normalizedDisplayName: 'hidden',
      mimeType: 'image/png',
      format: 'png',
      byteSize: 1n,
      originalObjectKey: `users/${other.id}/assets/${randomUUID()}/source.png`,
    },
  });
  await rejected(`/photos/assets/${foreign.id}/edit-renders`, input, 404);
  const first = await api(path, input),
    duplicate = await api(path, input);
  assert.equal(first.id, duplicate.id, 'same intent cannot create duplicate jobs');
  await rejected(
    path,
    { ...input, recipe: { ...recipe, edits: { ...recipe.edits, exposure: 16 } } },
    409,
  );
  async function complete(jobPath) {
    for (let i = 0; i < 120; i++) {
      const status = await api(jobPath);
      assert.notEqual(status.status, 'FAILED', JSON.stringify(status));
      if (status.status === 'COMPLETED') return status.asset;
      await delay(500);
    }
    throw new Error('Server render did not complete');
  }
  const result = await complete(`${path}/${first.id}`);
  const copy = await db.eagleAsset.findUniqueOrThrow({
    where: { id: result.id },
    include: { manualTagLinks: { include: { tag: true } }, editRecipe: true },
  });
  assert.equal(copy.ownerId, ownerId);
  assert.equal(copy.libraryMode, 'PHOTO');
  assert.equal(copy.width, 1920, 'crop uses original dimensions, never the 1600px preview');
  assert.ok(copy.height > 1920, 'server renders watermark at original resolution');
  assert.ok(copy.manualTagLinks.some((link) => link.tag.name === '已编辑'));
  assert.equal(copy.editRecipe.baseAssetId, source.id);
  const object = await storage.send(
    new GetObjectCommand({ Bucket: bucket, Key: copy.originalObjectKey }),
  );
  const rendered = Buffer.from(await object.Body.transformToByteArray());
  const expected = await renderServerPhoto(bytes, recipe.edits, {});
  assert.equal(
    createHash('sha256').update(rendered).digest('hex'),
    createHash('sha256').update(expected).digest('hex'),
    'same canonical pixel/crop/watermark renderer',
  );
  assert.equal(
    (await db.eagleAsset.findUniqueOrThrow({ where: { id: source.id } })).originalObjectKey,
    before.originalObjectKey,
    'source remains immutable',
  );
  const materialCreated = await upload('eagle', bytes, 'material-server-edit.jpg');
  const material = await api(`/eagle/assets/${materialCreated.assetId}`);
  const materialPath = `/eagle/assets/${material.id}/edit-renders`;
  const materialJob = await api(materialPath, {
    ...input,
    requestId: randomUUID(),
    mediaRevision: material.mediaRevision,
    rowVersion: material.rowVersion,
  });
  const materialCopy = await complete(`${materialPath}/${materialJob.id}`);
  assert.equal(
    (await db.eagleAsset.findUniqueOrThrow({ where: { id: materialCopy.id } })).libraryMode,
    'MATERIAL',
  );
  // The packaged 64³ Leica table exercises the actual ~4.2 MB wire payload.
  const png = decode(
    await readFile(
      new URL(
        '../../apps/web/src/components/media/photo-editor/bundled-luts/1.png',
        import.meta.url,
      ),
    ),
    { checkCrc: true },
  );
  const lut = writePortableLut(parsePngLut(png.data, png.width, png.height, png.channels));
  assert.equal((await api('/photos/media-capabilities')).serverPhotoEditing, 1);
  assert.equal((await api('/eagle/media-capabilities')).serverPhotoEditing, 1);
  const lutJob = await api(path, {
    ...input,
    requestId: randomUUID(),
    lut,
    recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:synthetic' } },
  });
  await complete(`${path}/${lutJob.id}`);
  const stale = await api(path, { ...input, requestId: randomUUID() });
  await db.eagleAsset.update({ where: { id: source.id }, data: { rowVersion: { increment: 1 } } });
  assert.equal(
    (await api(`${path}/${stale.id}`)).status,
    'FAILED',
    'stale source cannot publish as current',
  );
  log(
    'Server photo edits passed: full-resolution output, canonical effects, packaged 64³ Leica LUT, idempotency, owner/mode/Origin/DTO/version boundaries.',
  );
}
