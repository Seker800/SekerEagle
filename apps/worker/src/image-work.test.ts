import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImageWork, encodeImageWork, decodeImageWork } from './image-work';
test('shared local and remote image work preserves exact outputs and bounds', async () => {
  const bytes = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#fed123' },
  })
    .jpeg()
    .toBuffer();
  const work = {
    assetMimeType: 'image/jpeg',
    sourceMimeType: 'image/jpeg',
    kind: 'GENERATE_RENDITIONS',
    mode: 'MATERIAL',
    detailsOnly: false,
    verifiesOriginalHash: true,
  } as const;
  const result = await processImageWork(
    (async function* () {
      yield bytes;
    })(),
    work,
  );
  assert.equal(result.result.rendered?.length, 3);
  assert.equal(result.sha256.length, 64);
  const decoded = await decodeImageWork(encodeImageWork(result), work);
  assert.deepEqual(encodeImageWork(decoded), encodeImageWork(result));
  await assert.rejects(decodeImageWork(Buffer.from('{}'), work));
  const broken = await decodeImageWork(encodeImageWork(result), work);
  broken.result.rendered![0]!.spec.variant = '../../evil';
  await assert.rejects(decodeImageWork(encodeImageWork(broken), work));
});

test('binary image result avoids base64 expansion for real noisy image outputs', async () => {
  const source = await sharp(randomBytes(512 * 512 * 3), {
    raw: { width: 512, height: 512, channels: 3 },
  })
    .jpeg()
    .toBuffer();
  const work = {
    assetMimeType: 'image/jpeg',
    sourceMimeType: 'image/jpeg',
    kind: 'GENERATE_RENDITIONS',
    mode: 'MATERIAL',
    detailsOnly: false,
    verifiesOriginalHash: true,
  } as const;
  const result = await processImageWork(
    (async function* () {
      yield source;
    })(),
    work,
  );
  const binary = result.result.rendered!.reduce((sum, r) => sum + r.output.data.length, 0);
  const encoded = encodeImageWork(result);
  assert.ok(encoded.length < binary + 65536);
});

test('remote metadata rejects invalid dimensions, exposure values and live-photo identifiers', async () => {
  const work = {
    assetMimeType: 'image/jpeg',
    sourceMimeType: 'image/jpeg',
    kind: 'GENERATE_RENDITIONS',
    mode: 'MATERIAL',
    detailsOnly: false,
    verifiesOriginalHash: true,
  } as const;
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#123456' },
  })
    .jpeg()
    .toBuffer();
  const result = await processImageWork(
    (async function* () {
      yield bytes;
    })(),
    work,
  );
  const orientation = result.result.metadata.autoOrient;
  result.result.metadata.autoOrient = { width: 1e9, height: 1e9 };
  await assert.rejects(decodeImageWork(encodeImageWork(result), work), /INVALID_IMAGE_RESULT/);
  result.result.metadata.autoOrient = orientation;
  if ('photoAnalysis' in result.result) {
    result.result.photoAnalysis = { iso: 'x' } as never;
    await assert.rejects(decodeImageWork(encodeImageWork(result), work), /INVALID_IMAGE_RESULT/);
    result.result.photoAnalysis = null;
    result.result.livePhoto = { identifier: 42, motion: null } as never;
    await assert.rejects(decodeImageWork(encodeImageWork(result), work), /INVALID_IMAGE_RESULT/);
  }
});

test('the photo browse producer enforces its compact envelope without changing material or detail limits', async () => {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
    .jpeg()
    .toBuffer();
  const work = {
    assetMimeType: 'image/jpeg',
    sourceMimeType: 'image/jpeg',
    kind: 'GENERATE_RENDITIONS',
    mode: 'PHOTO',
    detailsOnly: false,
    verifiesOriginalHash: true,
  } as const;
  const result = await processImageWork(
    (async function* () {
      yield image;
    })(),
    { ...work, mode: 'MATERIAL' },
  );
  result.result.rendered![0]!.output.data = Buffer.alloc(33 * 1024 ** 2);
  assert.throws(() => encodeImageWork(result, work), /IMAGE_RESULT_TOO_LARGE/);
  assert.doesNotThrow(() => encodeImageWork(result, { ...work, detailsOnly: true }));
  assert.doesNotThrow(() => encodeImageWork(result, { ...work, mode: 'MATERIAL' }));
});
