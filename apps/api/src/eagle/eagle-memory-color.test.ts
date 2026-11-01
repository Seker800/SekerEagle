import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryMemoryIndex } from './eagle-memory-index';
import { residentColorPage, createMemoryColorScorer } from './eagle-memory-color';
import { COLOR_PALETTE_VERSION, paletteColorScore } from '@sekereagle/library-core';

const palette = [{ hex: '#69696a', weight: 1 }];
test('resident color ranking retains ordinary OR members, date tie breaks and both cursor directions', () => {
  const index = new LibraryMemoryIndex('owner', 'PHOTO');
  index.replace(
    '1',
    ['a', 'b', 'c'].map((id, at) => ({
      id,
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      rating: 4,
      mediaRevision: 0,
      libraryAddedAt: new Date(at),
      chronologicalAt: new Date(at),
      colorAnalyses:
        at === 2
          ? []
          : [
              {
                isCurrent: true,
                status: 'COMPLETED',
                assetRevision: 0,
                processorVersion: COLOR_PALETTE_VERSION,
                swatches: palette,
              },
            ],
    })),
  );
  const options = {
    where: { OR: [{ colorMatch: '#777777' }, { rating: 4 }] },
    color: '#777777',
    date: 'chronologicalAt' as const,
    limit: 1,
    offset: 0,
  };
  const first = residentColorPage(index, options);
  assert.deepEqual(
    first.map((row) => row.id),
    ['b', 'a'],
  );
  assert.equal(first[0]!.score, Math.sqrt(37));
  const next = residentColorPage(index, { ...options, after: first[0] });
  assert.deepEqual(
    next.map((row) => row.id),
    ['a', 'c'],
  );
  assert.equal(next[1]!.score, 100);
  assert.deepEqual(
    residentColorPage(index, { ...options, after: { ...next[0]!, newer: true } }).map(
      (row) => row.id,
    ),
    ['b'],
  );
});
test('bounded color memoization retains the existing algorithm even with caching disabled', () => {
  for (const bytes of [0, 1, 8192]) {
    const score = createMemoryColorScorer(bytes);
    for (const color of ['#777777', '#ffffff', '#0000ff']) {
      const row = {
        mediaRevision: 0,
        colorAnalyses: [
          {
            isCurrent: true,
            status: 'COMPLETED',
            assetRevision: 0,
            processorVersion: COLOR_PALETTE_VERSION,
            swatches: palette,
          },
        ],
      };
      assert.equal(score(row, color), paletteColorScore(color, palette));
      assert.equal(score(row, color), paletteColorScore(color, palette));
      assert.equal(score({ ...row, mediaRevision: 1 }, color), null);
    }
  }
});
