import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMemorySearchPredicate } from './eagle-memory-predicate';
import { buildEagleFilterWhere } from './eagle-filter-query';
import type { AssetSearchWhere } from './eagle-search-predicate';
import { COLOR_PALETTE_VERSION } from '@sekereagle/library-core';

const asset = {
  id: 'asset',
  ownerId: 'owner',
  libraryMode: 'PHOTO',
  isPrivate: false,
  deletedAt: null,
  normalizedDisplayName: 'sea_100%',
  format: 'jpg',
  rating: null,
  width: 4000,
  height: 3000,
  byteSize: '9007199254740993',
  aspectRatio: 4 / 3,
  libraryAddedAt: '2026-11-01T00:00:00.000Z',
  annotation: null,
  photoMetadata: { cameraModel: null, lensModel: 'lens' },
  manualTagLinks: [{ tagId: 'sea' }],
  aiTagLinks: [{ aiTagId: 'blue', status: 'ACTIVE' }],
  photoFaces: [{ personId: 'person', isCurrent: true }],
};
test('memory predicates keep scope, scalar comparisons and exact bigint values', () => {
  assert.equal(compileMemorySearchPredicate({ ownerId: 'other' })(asset), false);
  assert.equal(compileMemorySearchPredicate({ byteSize: { gt: 9007199254740992n } })(asset), true);
  assert.equal(compileMemorySearchPredicate({ rating: { not: 1 } })(asset), false);
  assert.equal(compileMemorySearchPredicate({ rating: null })(asset), true);
  assert.equal(
    compileMemorySearchPredicate({ libraryAddedAt: { gte: new Date('2026-10-31') } })(asset),
    true,
  );
});
test('SQL three-valued nulls remain unknown under NOT and OR', () => {
  const nullCamera: AssetSearchWhere = { photoMetadata: { is: { cameraModel: 'camera' } } };
  assert.equal(compileMemorySearchPredicate({ NOT: nullCamera })(asset), false);
  assert.equal(
    compileMemorySearchPredicate({ NOT: nullCamera })({ ...asset, photoMetadata: null }),
    true,
  );
  assert.equal(compileMemorySearchPredicate({ NOT: { rating: { gt: 2 } } })(asset), false);
  assert.equal(
    compileMemorySearchPredicate({ OR: [{ rating: { gt: 2 } }, { format: 'jpg' }] })(asset),
    true,
  );
});
test('canonical empty camera rules include absent, NULL and empty but not a value', () => {
  const where = buildEagleFilterWhere(
    {
      version: 2,
      conditions: [
        {
          id: 'group',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'empty', field: 'CAMERA_MODEL', operator: 'EMPTY' }],
        },
      ],
    },
    'PHOTO',
  );
  const match = compileMemorySearchPredicate(where);
  for (const photoMetadata of [null, { cameraModel: null }, { cameraModel: '' }])
    assert.equal(match({ ...asset, photoMetadata }), true);
  assert.equal(match({ ...asset, photoMetadata: { cameraModel: 'camera' } }), false);
});
test('tag, person and annotation relations reuse canonical predicates', () => {
  assert.equal(
    compileMemorySearchPredicate({ manualTagLinks: { some: { tagId: { in: ['sea'] } } } })(asset),
    true,
  );
  assert.equal(
    compileMemorySearchPredicate({ aiTagLinks: { none: { aiTagId: 'blue', status: 'ACTIVE' } } })(
      asset,
    ),
    false,
  );
  assert.equal(
    compileMemorySearchPredicate({ photoFaces: { some: { personId: 'person', isCurrent: true } } })(
      asset,
    ),
    true,
  );
  assert.equal(compileMemorySearchPredicate({ annotation: { is: null } })(asset), true);
});
test('LIKE wildcard, escaping and case semantics match the SQL adapter', () => {
  for (const pattern of ['sea%', 'sea_100%', 'SEA\\_100\\%']) {
    assert.equal(
      compileMemorySearchPredicate({
        normalizedDisplayName: { equals: pattern, mode: 'insensitive' },
      })(asset),
      true,
    );
  }
  assert.equal(
    compileMemorySearchPredicate({ normalizedDisplayName: { contains: 'other' } })(asset),
    false,
  );
});
test('unsupported fields and semantic relations fail closed before scanning', () => {
  assert.throws(
    () => compileMemorySearchPredicate({ unknown: 1 } as AssetSearchWhere),
    /Unsupported/,
  );
  assert.throws(() => compileMemorySearchPredicate({ embeddings: { some: {} } }), /Unsupported/);
});

test('scalar operator matrix preserves SQL empty sets, ranges, dates and unknowns', () => {
  const yes: AssetSearchWhere[] = [
    { AND: [] },
    { NOT: [] },
    { width: { equals: 4000, gte: 4000, lte: 4000 } },
    { width: { lt: 5000, gt: 3000 } },
    { width: { not: 3000 } },
    { width: { in: [3000, 4000], notIn: [1, 2] } },
    { rating: { notIn: [] } },
    { format: { startsWith: 'j', endsWith: 'g', contains: 'p' } },
    { format: { equals: 'jpg', mode: 'default' } },
    { libraryAddedAt: { lt: new Date('2026-12-01'), gt: new Date('2026-10-01') } },
  ];
  for (const where of yes) assert.equal(compileMemorySearchPredicate(where)(asset), true);
  for (const where of [
    { OR: [] },
    { width: { in: [] } },
    { rating: { in: [1] } },
    { rating: { not: null } },
  ])
    assert.equal(compileMemorySearchPredicate(where)(asset), false);
  assert.equal(
    compileMemorySearchPredicate({ AND: [{ rating: { gt: 1 } }, { format: 'png' }] })(asset),
    false,
  );
  assert.equal(
    compileMemorySearchPredicate({ OR: [{ rating: { gt: 1 } }, { format: 'png' }] })(asset),
    false,
  );
});

test('relation operators distinguish missing, null, none and every', () => {
  for (const where of [
    { photoMetadata: { cameraModel: null } },
    { photoMetadata: { isNot: null } },
    { manualTagLinks: { every: { tagId: 'sea' } } },
    { manualTagLinks: { none: { tagId: 'other' } } },
    { annotation: null },
  ])
    assert.equal(compileMemorySearchPredicate(where)(asset), true);
  assert.equal(
    compileMemorySearchPredicate({ photoMetadata: { isNot: { cameraModel: 'camera' } } })(asset),
    false,
  );
  assert.equal(
    compileMemorySearchPredicate({ manualTagLinks: { every: { tagId: 'other' } } })(asset),
    false,
  );
});

test('color matching reuses the current palette algorithm and media revision guard', () => {
  const analysis = {
    isCurrent: true,
    status: 'COMPLETED',
    processorVersion: COLOR_PALETTE_VERSION,
    assetRevision: 2,
    swatches: [
      { hex: '#ffffff', weight: 0.8 },
      { hex: '#000000', weight: 0.2 },
    ],
  };
  const match = compileMemorySearchPredicate({ colorMatch: '#ffffff' });
  assert.equal(match({ ...asset, mediaRevision: 2, colorAnalyses: [analysis] }), true);
  assert.equal(match({ ...asset, mediaRevision: 3, colorAnalyses: [analysis] }), false);
  assert.equal(match(asset), false);
});

test('malformed predicate input is rejected rather than treated as a successful match', () => {
  for (const where of [
    null,
    { format: { unknown: 'jpg' } },
    { format: { mode: 'unknown' } },
    { format: { in: 'jpg' } },
    { format: { equals: {} } },
    { format: { startsWith: 3 } },
    { photoMetadata: { is: {}, unknown: 1 } },
    { colorMatch: 1 },
  ]) {
    assert.throws(() => compileMemorySearchPredicate(where as AssetSearchWhere), /Unsupported/);
  }
});

test('unverified Unicode case folding and missing projected fields retain SQL fallback', () => {
  const insensitive = compileMemorySearchPredicate({
    normalizedDisplayName: { contains: 'i', mode: 'insensitive' },
  });
  assert.throws(() => insensitive({ ...asset, normalizedDisplayName: 'İmage' }), /Unsupported/);
  assert.throws(
    () => compileMemorySearchPredicate({ width: { gt: 1 } })({ id: 'incomplete' }),
    /Unsupported/,
  );
});

test('case-insensitive string negation keeps its mode on the primitive operand', () => {
  assert.equal(
    compileMemorySearchPredicate({ format: { not: 'JPG', mode: 'insensitive' } })(asset),
    false,
  );
});

test('partial relation projections reject queries for history before scanning', () => {
  for (const where of [
    { photoFaces: { some: { personId: 'person' } } },
    { photoFaces: { every: { personId: 'person', isCurrent: true } } },
    { aiTagLinks: { none: { aiTagId: 'blue' } } },
    { colorAnalyses: { some: { isCurrent: false } } },
  ])
    assert.throws(() => compileMemorySearchPredicate(where as AssetSearchWhere), /Unsupported/);
});

test('SQL LIKE end anchors do not accept an extra final newline', () => {
  const row = { ...asset, normalizedDisplayName: 'sea\n' };
  assert.equal(compileMemorySearchPredicate({ normalizedDisplayName: { equals: 'SEA', mode: 'insensitive' } })(row), false);
  assert.equal(compileMemorySearchPredicate({ normalizedDisplayName: { endsWith: 'sea' } })(row), false);
});
