import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAltRightClickTracker,
  resolveCaptureTarget,
} from '../src/capture-interaction.js';

test('recognizes Alt held on right-button down even when contextmenu loses modifier state', () => {
  const tracker = createAltRightClickTracker();
  tracker.remember(
    { isTrusted: true, button: 2, altKey: true, clientX: 120, clientY: 80 },
    1_000,
  );

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
      altText: 'Reference photo',
    },
  );
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
      altText: 'Cover artwork',
    },
  );
});
