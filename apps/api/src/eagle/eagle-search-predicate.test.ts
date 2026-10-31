import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSearchPredicate } from './eagle-search-predicate';
import { buildEagleFilterWhere } from './eagle-filter-query';

test('search compiles the canonical asset filters into a bound, owner-scoped SQL predicate', () => {
  const hostile = "相机' OR true --";
  const query = compileSearchPredicate({
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    AND: [
      { photoMetadata: { is: { cameraModel: { contains: hostile, mode: 'insensitive' } } } },
      { manualTagLinks: { none: { tagId: { in: ['tag'] } } } },
      { NOT: { photoMetadata: { is: null } } },
    ],
  });
  assert.match(query.sql, /EXISTS/);
  assert.match(query.sql, /"EaglePhotoMetadata"/);
  assert.match(query.sql, /"EagleAssetManualTag"/);
  assert.match(query.sql, /::"LibraryMode"/);
  assert.ok(!query.sql.includes(hostile));
  assert.ok(query.values.includes(`%${hostile}%`));
});

test('the shared rule engine remains the only definition of search filter behavior', () => {
  const where = buildEagleFilterWhere(
    {
      version: 2,
      conditions: [
        {
          id: 'c',
          match: 'ANY',
          result: 'NOT_MATCH',
          rules: [
            { id: 'a', field: 'GPS', operator: 'EQUALS', value: 'WITH' },
            { id: 'b', field: 'RATING', operator: 'EQUALS', value: '0' },
            { id: 'c', field: 'COLOR', operator: 'EQUALS', value: '#aabbcc' },
          ],
        },
      ],
    },
    'PHOTO',
  );
  const query = compileSearchPredicate(where);
  assert.match(query.sql, /NOT/);
  assert.match(query.sql, /"EagleAssetColorSwatch"/);
  assert.match(query.sql, /"EagleColorAnalysisStatus"/);
});

test('unsupported fields and operators fail closed instead of falling back to an unbounded ID list', () => {
  assert.throws(
    () => compileSearchPredicate({ unreviewedField: 1 } as never),
    /Unsupported search/,
  );
  assert.throws(
    () => compileSearchPredicate({ rating: { unreviewedOperator: 1 } } as never),
    /Unsupported search/,
  );
});
