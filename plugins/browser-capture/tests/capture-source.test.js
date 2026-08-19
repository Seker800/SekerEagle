import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCaptureSourceCandidates } from '../src/capture-source.js';

test('normalizes, deduplicates and bounds untrusted candidate URLs', () => {
  const candidates = normalizeCaptureSourceCandidates({
    sourceUrl: 'https://cdn.example.com/current.jpg',
    sourceCandidates: [
      'https://cdn.example.com/original.jpg',
      'javascript:alert(1)',
      'https://cdn.example.com/original.jpg',
      '  https://cdn.example.com/current.jpg  ',
      ...Array.from({ length: 20 }, (_, index) => `https://cdn.example.com/${index}.jpg`),
    ],
  });

  assert.equal(candidates.length, 12);
  assert.deepEqual(candidates.slice(0, 2), [
    'https://cdn.example.com/original.jpg',
    'https://cdn.example.com/current.jpg',
  ]);
  assert.equal(candidates.some((candidate) => candidate.startsWith('javascript:')), false);
});

test('retains supported data and blob fallbacks while rejecting malformed values', () => {
  assert.deepEqual(
    normalizeCaptureSourceCandidates({
      sourceUrl: 'not a URL',
      sourceCandidates: ['data:image/png;base64,AA==', 'blob:https://example.com/image-id'],
    }),
    ['data:image/png;base64,AA==', 'blob:https://example.com/image-id'],
  );
});
