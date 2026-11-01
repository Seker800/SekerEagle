import { memoryPaletteKey } from '../../apps/api/dist/eagle/eagle-memory-color-score.js';
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { performance } from 'node:perf_hooks';
import { LibraryMemoryIndex } from '../../apps/api/dist/eagle/eagle-memory-index.js';

const count = Number(process.argv.find((value) => /^\d+$/.test(value)) ?? 127549);
assert.ok(Number.isSafeInteger(count) && count > 0);
globalThis.gc?.();
const baseline = process.memoryUsage().rss;
const indexes = ['MATERIAL', 'PHOTO'].map(
  (mode) => new LibraryMemoryIndex('synthetic-owner', mode),
);
const started = performance.now();
for (const [at, index] of indexes.entries()) {
  const amount = at === 0 ? Math.ceil(count / 2) : Math.floor(count / 2);
  const rows = Array.from({ length: amount }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ownerId: 'synthetic-owner',
    libraryMode: index.libraryMode,
    normalizedDisplayName: `示例素材 ${i}`,
    originalName: `photo-${i}.jpg`,
    format: 'jpg',
    mimeType: 'image/jpeg',
    byteSize: '20000000',
    width: 6000,
    height: 4000,
    aspectRatio: 1.5,
    durationMs: null,
    rating: i % 6 || null,
    isPrivate: i % 20 === 0,
    deletedAt: null,
    purgeAfter: null,
    mediaRevision: 0,
    rowVersion: 1,
    libraryAddedAt: new Date(1760000000000 + i * 1000),
    chronologicalAt: new Date(1760000000000 + i * 1000),
    updatedAt: new Date(1760000000000 + i * 1000),
    annotation: { description: `示例说明 ${i}`, sourceUrl: `https://example.invalid/${i}` },
    photoMetadata: {
      cameraModel: i % 5 ? 'camera' : null,
      lensModel: 'lens',
      latitude: null,
      longitude: null,
    },
    photoLocation: null,
    manualTagLinks: Array.from({ length: i % 3 }, (_, j) => ({
      tagId: `manual-${j}`,
      tag: { normalizedName: `标签 ${j}` },
    })),
    aiTagLinks: Array.from({ length: i % 6 }, (_, j) => ({ aiTagId: `ai-${j}`, status: 'ACTIVE' })),
    photoFaces: i % 10 ? [] : [{ personId: 'person', isCurrent: true, assetRevision: 0 }],
    statisticsFact:
      index.libraryMode === 'PHOTO'
        ? {
            day: new Date(1600000000000 + (i % 6000) * 86400000).toISOString().slice(0, 10),
            camera: 'camera',
            lens: 'lens',
            device: 'camera',
          }
        : null,
    colorAnalyses: [
      {
        id: `palette-${i}`,
        assetRevision: 0,
        processorVersion: 'color-v4-eagle-basic',
        status: 'COMPLETED',
        isCurrent: true,
        swatches: [
          { hex: '#ffffff', weight: 0.8 },
          { hex: '#000000', weight: 0.2 },
        ],
      },
    ],
  }));
  for (const row of rows)
    for (const analysis of row.colorAnalyses)
      analysis.paletteKey = memoryPaletteKey(analysis.swatches);
  index.replace('1', rows);
  // Reuse the built-in sort ahead of interactive queries, just like a loaded library.
  for (const date of ['libraryAddedAt', 'chronologicalAt']) index.page({}, date, 'desc', 0, 0);
}
const loadAndSortMs = performance.now() - started;
globalThis.gc?.();
const cases = {
  firstPage: { format: 'jpg' },
  noCameraSnapshotMatch: { photoMetadata: { is: { cameraModel: 'nonexistent' } } },
  noCameraMatch: { photoMetadata: { is: { cameraModel: 'nonexistent' } } },
  noColorMatch: { colorMatch: '#ff0000' },
  noTagMatch: { manualTagLinks: { some: { tagId: 'nonexistent' } } },
  negatedCamera: { NOT: { photoMetadata: { is: { cameraModel: 'camera' } } } },
};
const samples = {};
for (const [name, where] of Object.entries(cases)) {
  const times = [];
  for (let i = 0; i < 110; i++) {
    const begin = performance.now();
    const pages = indexes.map((index) =>
      (name === 'noCameraSnapshotMatch' ? index.snapshot() : index).page(
        where,
        'chronologicalAt',
        'desc',
        41,
        0,
      ),
    );
    if (name.startsWith('no')) assert.ok(pages.every((page) => page.length === 0));
    if (i >= 10) times.push(performance.now() - begin);
  }
  times.sort((a, b) => a - b);
  samples[name] = { p95Ms: +times[95].toFixed(2), p99Ms: +times[99].toFixed(2) };
}
globalThis.gc?.();
const rssMiB = process.memoryUsage().rss / 1048576;
log(
  JSON.stringify(
    {
      count,
      modes: 2,
      loadAndSortMs: Math.round(loadAndSortMs),
      incrementalRssMiB: Math.round((process.memoryUsage().rss - baseline) / 1048576),
      rssMiB: Math.round(rssMiB),
      peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
      samples,
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      measurement: 'synthetic in-memory compute; excludes database, HTTP and thumbnails',
    },
    null,
    2,
  ),
);
if (process.argv.includes('--verify'))
  assert.ok(rssMiB < 1024, 'Reader prototype exceeds the one GiB process budget');
