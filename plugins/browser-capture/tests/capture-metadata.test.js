import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCaptureMetadata,
  deriveDisplayName,
  sanitizeImageSourceUrl,
} from '../src/capture-metadata.js';

test('derives Eagle-like names from alt text, meaningful file names, then page title', () => {
  assert.equal(
    deriveDisplayName({ altText: '  Mountain Study  ', imageUrl: 'https://cdn.test/a.jpg', pageTitle: 'Page' }),
    'Mountain Study',
  );
  assert.equal(
    deriveDisplayName({ altText: '', imageUrl: 'https://cdn.test/reference-board.png', pageTitle: 'Page' }),
    'reference-board',
  );
  assert.equal(
    deriveDisplayName({ altText: '', imageUrl: 'https://cdn.test/4f31c8a927c94f0f.jpg', pageTitle: 'Gallery' }),
    'Gallery',
  );
});

test('keeps page provenance while removing credentials, fragments, and signed image queries', () => {
  const metadata = buildCaptureMetadata({
    pageUrl: 'https://user:secret@example.com/gallery?id=7#private',
    pageTitle: 'Gallery',
    imageUrl: 'https://cdn.example.com/photo.jpg?X-Amz-Signature=secret#fragment',
    altText: 'Photo',
  });

  assert.equal(metadata.pageUrl, 'https://example.com/gallery?id=7');
  assert.equal(metadata.imageUrl, 'https://cdn.example.com/photo.jpg');
  assert.equal(sanitizeImageSourceUrl('blob:https://example.com/id'), null);
});
