import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { renderImageRenditions } from './image-renditions';
import { selectImageJobSource } from './image-job-source';

test('browse renditions decode the source once and preserve oriented, bounded dimensions', async () => {
  const bytes = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#927ca0' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const source = sharp(bytes);
  let sourceClones = 0;
  const clone = source.clone.bind(source);
  source.clone = () => {
    sourceClones++;
    return clone();
  };
  const rendered = await renderImageRenditions(source, 'image/jpeg', 'BROWSE');
  assert.equal(sourceClones, 1);
  assert.deepEqual(
    rendered.map((r) => [r.spec.variant, r.output.info.width, r.output.info.height]),
    [
      ['default', 1067, 1600],
      ['256', 171, 256],
      ['512', 341, 512],
    ],
  );
  for (const r of rendered)
    assert.equal((await sharp(r.output.data).metadata()).orientation, undefined);
});

test('ordinary photo details select only a current browse preview; RAW editing retains the original', () => {
  const asset = {
    originalObjectKey: 'original.heic',
    mimeType: 'image/heic',
    mediaRevision: 2,
    renditions: [
      {
        kind: 'PREVIEW',
        variant: 'edit',
        revision: 2,
        status: 'READY',
        storageKey: 'edit.webp',
        mimeType: 'image/webp',
      },
      {
        kind: 'PREVIEW',
        variant: 'default',
        revision: 1,
        status: 'READY',
        storageKey: 'old.webp',
        mimeType: 'image/webp',
      },
      {
        kind: 'PREVIEW',
        variant: 'default',
        revision: 2,
        status: 'READY',
        storageKey: 'preview.webp',
        mimeType: 'image/webp',
      },
    ],
  };
  assert.equal(
    selectImageJobSource(asset, 'GENERATE_RENDITIONS', 'photo-source-details-v1').storageKey,
    'preview.webp',
  );
  assert.equal(
    selectImageJobSource(
      { ...asset, mimeType: 'image/x-fuji-raf' },
      'GENERATE_RENDITIONS',
      'photo-source-details-v1',
    ).storageKey,
    'original.heic',
  );
  assert.throws(
    () =>
      selectImageJobSource(
        { ...asset, renditions: asset.renditions.slice(0, 2) },
        'GENERATE_RENDITIONS',
        'photo-source-details-v1',
      ),
    /READY_PREVIEW_MISSING/,
  );
});

test('small transparent images are never enlarged; RAW edit stays lossless on its independent source', async () => {
  const source = sharp({
    create: {
      width: 60,
      height: 40,
      channels: 4,
      background: { r: 120, g: 80, b: 40, alpha: 0.5 },
    },
  });
  for (const rendition of await renderImageRenditions(source, 'image/png', 'BROWSE')) {
    assert.equal(rendition.output.info.width, 60);
    assert.equal((await sharp(rendition.output.data).metadata()).hasAlpha, true);
  }
  const [edit] = await renderImageRenditions(source, 'image/x-fuji-raf', 'DETAILS');
  assert.equal(edit?.spec.variant, 'edit');
  assert.equal(edit?.spec.encoding.lossless, true);
  assert.equal(edit?.output.info.width, 60);
  assert.deepEqual(await renderImageRenditions(source, 'image/jpeg', 'DETAILS'), []);
});
