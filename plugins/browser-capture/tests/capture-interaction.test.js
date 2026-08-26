import assert from 'node:assert/strict';
import test from 'node:test';
import { createAltRightClickTracker, resolveCaptureTarget } from '../src/capture-interaction.js';

test('recognizes Alt held on right-button down even when contextmenu loses modifier state', () => {
  const tracker = createAltRightClickTracker();
  tracker.remember({ isTrusted: true, button: 2, altKey: true, clientX: 120, clientY: 80 }, 1_000);

  assert.equal(
    tracker.matches(
      { isTrusted: true, button: 2, altKey: false, clientX: 122, clientY: 81 },
      1_200,
    ),
    true,
  );
  assert.equal(
    tracker.matches(
      { isTrusted: true, button: 2, altKey: false, clientX: 160, clientY: 120 },
      1_200,
    ),
    false,
  );
});

test('finds an image underneath an overlay using point hit-test candidates', () => {
  const overlay = { tagName: 'DIV' };
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://cdn.example.com/full/photo.webp',
    src: 'https://cdn.example.com/thumb/photo.webp',
    alt: 'Reference photo',
  };

  assert.deepEqual(
    resolveCaptureTarget({
      path: [overlay],
      elementsAtPoint: [overlay, image],
      baseUrl: 'https://example.com/gallery',
      getStyle: () => ({ backgroundImage: 'none' }),
    }),
    {
      sourceUrl: 'https://cdn.example.com/full/photo.webp',
      sourceCandidates: [
        'https://cdn.example.com/full/photo.webp',
        'https://cdn.example.com/thumb/photo.webp',
      ],
      altText: 'Reference photo',
    },
  );
});

test('ranks responsive image candidates by intrinsic quality before rendered fallbacks', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://cdn.example.com/rendered-640.jpg',
    src: 'https://cdn.example.com/fallback-320.jpg',
    srcset:
      'https://cdn.example.com/responsive-960.jpg 960w, /responsive-2400.jpg 2400w, /responsive-1600.jpg 1600w',
    naturalWidth: 640,
    alt: 'Responsive photo',
    getAttribute(name) {
      return name === 'srcset' ? this.srcset : null;
    },
  };
  const picture = {
    tagName: 'PICTURE',
    querySelector: () => image,
    querySelectorAll: () => [
      {
        tagName: 'SOURCE',
        srcset: '/picture-3200.webp 3200w, /picture-1280.webp 1280w',
        media: '(min-width: 1000px)',
      },
      {
        tagName: 'SOURCE',
        srcset: '/wrong-art-direction-4000.jpg 4000w',
        media: '(orientation: portrait)',
      },
    ],
  };

  assert.deepEqual(
    resolveCaptureTarget({
      path: [picture],
      elementsAtPoint: [],
      baseUrl: 'https://example.com/gallery/',
      getStyle: () => ({ backgroundImage: 'none' }),
      matchesMedia: (query) => query !== '(orientation: portrait)',
    }),
    {
      sourceUrl: 'https://example.com/picture-3200.webp',
      sourceCandidates: [
        'https://example.com/picture-3200.webp',
        'https://example.com/responsive-2400.jpg',
        'https://example.com/responsive-1600.jpg',
        'https://example.com/picture-1280.webp',
        'https://cdn.example.com/responsive-960.jpg',
        'https://cdn.example.com/rendered-640.jpg',
        'https://cdn.example.com/fallback-320.jpg',
      ],
      altText: 'Responsive photo',
    },
  );
});

test('uses direct image links and semantic high-resolution attributes before rendered sources', () => {
  const imageLink = {
    href: 'https://cdn.example.com/original/photo.png?download=1',
    getAttribute: (name) => (name === 'href' ? '/original/photo.png?download=1' : null),
  };
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://cdn.example.com/thumb/photo.webp',
    src: 'https://cdn.example.com/thumb/photo.webp',
    alt: 'Linked photo',
    closest: () => imageLink,
    getAttribute(name) {
      return name === 'data-original' ? '/original/from-data.jpg' : null;
    },
  };

  assert.deepEqual(
    resolveCaptureTarget({
      path: [image],
      baseUrl: 'https://cdn.example.com/gallery/',
      getStyle: () => ({ backgroundImage: 'none' }),
    }),
    {
      sourceUrl: 'https://cdn.example.com/original/photo.png?download=1',
      sourceCandidates: [
        'https://cdn.example.com/original/photo.png?download=1',
        'https://cdn.example.com/original/from-data.jpg',
        'https://cdn.example.com/thumb/photo.webp',
      ],
      altText: 'Linked photo',
    },
  );
});

test('ignores ordinary page links and always retains rendered fallbacks within the candidate bound', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://cdn.example.com/rendered.jpg',
    src: 'https://cdn.example.com/fallback.jpg',
    srcset: Array.from(
      { length: 20 },
      (_, index) => `https://cdn.example.com/responsive-${index + 1}.jpg ${(index + 1) * 100}w`,
    ).join(', '),
    alt: 'Bounded candidates',
    closest: (selector) =>
      selector === 'a[href]'
        ? {
            href: 'https://example.com/photo/details',
            download: '',
            hasAttribute: () => false,
            getAttribute: () => null,
          }
        : null,
    getAttribute(name) {
      return name === 'srcset' ? this.srcset : null;
    },
  };

  const target = resolveCaptureTarget({
    path: [image],
    baseUrl: 'https://example.com/gallery/',
    getStyle: () => ({ backgroundImage: 'none' }),
  });

  assert.deepEqual(target.sourceCandidates, [
    ...Array.from(
      { length: 10 },
      (_, index) => `https://cdn.example.com/responsive-${20 - index}.jpg`,
    ),
    'https://cdn.example.com/rendered.jpg',
    'https://cdn.example.com/fallback.jpg',
  ]);
});

test('collects a non-repeating CSS background image when no img element is hit', () => {
  const card = { tagName: 'DIV', textContent: 'Cover artwork' };

  assert.deepEqual(
    resolveCaptureTarget({
      path: [card],
      elementsAtPoint: [card],
      baseUrl: 'https://example.com/gallery/',
      getStyle: () => ({
        backgroundImage: 'url("../images/cover.jpg")',
        backgroundRepeat: 'no-repeat',
      }),
    }),
    {
      sourceUrl: 'https://example.com/images/cover.jpg',
      sourceCandidates: ['https://example.com/images/cover.jpg'],
      altText: 'Cover artwork',
    },
  );
});

test('collects repeated, layered, masked and pseudo-element CSS images', () => {
  const card = {
    tagName: 'DIV',
    textContent: 'Layered artwork',
    getAttribute: () => null,
  };

  assert.deepEqual(
    resolveCaptureTarget({
      path: [card],
      baseUrl: 'https://example.com/gallery/',
      getStyle: (_element, pseudo) =>
        pseudo === '::before'
          ? { content: 'url("/images/badge.avif")' }
          : {
              backgroundImage: 'linear-gradient(#000, transparent), url("../images/cover.jpg")',
              backgroundRepeat: 'repeat',
              maskImage: 'url("/images/mask.png")',
            },
    }),
    {
      sourceUrl: 'https://example.com/images/cover.jpg',
      sourceCandidates: [
        'https://example.com/images/cover.jpg',
        'https://example.com/images/mask.png',
        'https://example.com/images/badge.avif',
      ],
      altText: 'Layered artwork',
    },
  );
});
