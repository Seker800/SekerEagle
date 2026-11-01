import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMemorySearchPredicate } from './eagle-memory-predicate';
import { buildEagleFilterWhere } from './eagle-filter-query';
import type { AssetSearchWhere } from './eagle-search-predicate';

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
