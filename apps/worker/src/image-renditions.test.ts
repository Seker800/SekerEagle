import assert from 'node:assert/strict';
import test from 'node:test';
import { imageRenditionSpecs, catalogImageDimensions } from './image-renditions';

test('RAW adds a bounded lossless edit derivative without enlarging ordinary preview requests', () => {
  const specs = imageRenditionSpecs('image/x-fuji-raf');
  assert.deepEqual(
    specs.map(({ kind, variant, maxSize }) => ({ kind, variant, maxSize })),
    [
      { kind: 'PREVIEW', variant: 'default', maxSize: 1600 },
      { kind: 'THUMBNAIL', variant: '256', maxSize: 256 },
      { kind: 'THUMBNAIL', variant: '512', maxSize: 512 },
      { kind: 'PREVIEW', variant: 'edit', maxSize: 6000 },
    ],
  );
  assert.deepEqual(specs.at(-1)?.encoding, { lossless: true });
  assert.equal(imageRenditionSpecs('image/jpeg').length, 3);
  assert.equal(imageRenditionSpecs('image/x-adobe-dng').length, 4);
});

test('catalog keeps original oriented RAW dimensions while pyramids use decoded dimensions', () => {
  const decoded = { width: 5824, height: 4368, autoOrient: { width: 5824, height: 4368 } };
  assert.deepEqual(catalogImageDimensions(decoded, { width: 11648, height: 8736 }), {
    width: 11648,
    height: 8736,
  });
  assert.deepEqual(catalogImageDimensions(decoded), { width: 5824, height: 4368 });
  assert.deepEqual(
    catalogImageDimensions({
      width: 4000,
      height: 3000,
      autoOrient: { width: 3000, height: 4000 },
    }),
    { width: 3000, height: 4000 },
  );
  assert.deepEqual(catalogImageDimensions({ width: 10, height: 20 }), { width: 10, height: 20 });
});
