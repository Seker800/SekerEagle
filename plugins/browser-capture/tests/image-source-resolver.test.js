import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCaptureUrl, resolveImageSourceTarget } from '../src/image-source-resolver.js';

test('accepts only supported absolute or page-relative capture URLs', () => {
  assert.equal(resolveCaptureUrl('', 'https://example.com/page'), null);
  assert.equal(resolveCaptureUrl('http://[', 'https://example.com/page'), null);
  assert.equal(resolveCaptureUrl('javascript:alert(1)', 'https://example.com/page'), null);
  assert.equal(
    resolveCaptureUrl('../image.jpg', 'https://example.com/gallery/page'),
    'https://example.com/image.jpg',
  );
  assert.equal(
    resolveCaptureUrl('data:image/png;base64,AA==', 'https://example.com/page'),
    'data:image/png;base64,AA==',
  );
});

test('returns no target for non-image elements or images without a usable source', () => {
  assert.equal(resolveImageSourceTarget({ tagName: 'DIV' }, 'https://example.com/'), null);
  assert.equal(
    resolveImageSourceTarget({ tagName: 'IMG', getAttribute: () => null }, 'https://example.com/'),
    null,
  );
});

test('supports density descriptors and source attributes while skipping failed media queries', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://cdn.example.com/current.jpg',
    srcset:
      'https://cdn.example.com/no-descriptor.jpg, https://cdn.example.com/density.jpg 2x, https://cdn.example.com/invalid.jpg invalid',
    naturalWidth: 700,
    alt: '  Density   photo  ',
    closest: (selector) => (selector === 'picture' ? picture : null),
    getAttribute: () => null,
  };
  const picture = {
    tagName: 'PICTURE',
    querySelectorAll: () => [
      {
        getAttribute: (name) =>
          name === 'media' ? '(broken-query)' : 'https://cdn.example.com/skipped.jpg 4000w',
      },
    ],
  };

  const result = resolveImageSourceTarget(image, 'https://example.com/', () => {
    throw new Error('unsupported media query');
  });

  assert.deepEqual(result, {
    sourceUrl: 'https://cdn.example.com/density.jpg',
    sourceCandidates: [
      'https://cdn.example.com/density.jpg',
      'https://cdn.example.com/no-descriptor.jpg',
      'https://cdn.example.com/invalid.jpg',
      'https://cdn.example.com/current.jpg',
    ],
    altText: 'Density photo',
  });
});

test('accepts a pathless direct link only when the anchor explicitly declares an image type', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://cdn.example.com/current.jpg',
    alt: '',
    closest: (selector) =>
      selector === 'a[href]'
        ? {
            href: 'https://cdn.example.com/download?id=1',
            type: 'image/jpeg',
            hasAttribute: () => false,
          }
        : null,
    getAttribute: () => null,
  };

  assert.equal(
    resolveImageSourceTarget(image, 'https://example.com/').sourceUrl,
    'https://cdn.example.com/download?id=1',
  );
});
