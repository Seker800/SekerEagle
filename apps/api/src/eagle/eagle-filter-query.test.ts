import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEagleFilterWhere, readEagleFilterQuery } from './eagle-filter-query';

test('compiles negated ANY groups without losing the owner-independent rule structure', () => {
  const query = readEagleFilterQuery({
    version: 2,
    conditions: [
      {
        id: 'condition-1',
        match: 'ANY',
        result: 'NOT_MATCH',
        rules: [
          { id: 'rule-1', field: 'FORMAT', operator: 'EQUALS', value: 'png' },
          { id: 'rule-2', field: 'RATING', operator: 'GTE', value: '4' },
        ],
      },
    ],
  });

  assert.deepEqual(buildEagleFilterWhere(query), {
    AND: [{ NOT: { OR: [{ format: 'png' }, { rating: { gte: 4 } }] } }],
  });
});

test('compiles all selected tags as independent requirements', () => {
  const where = buildEagleFilterWhere(
    readEagleFilterQuery({
      version: 2,
      conditions: [
        {
          id: 'condition-1',
          match: 'ALL',
          result: 'MATCH',
          rules: [
            {
              id: 'rule-1',
              field: 'MANUAL_TAGS',
              operator: 'ALL_OF',
              value: ['tag-1', 'tag-2'],
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(where, {
    AND: [
      {
        AND: [
          {
            AND: [
              { manualTagLinks: { some: { tagId: 'tag-1' } } },
              { manualTagLinks: { some: { tagId: 'tag-2' } } },
            ],
          },
        ],
      },
    ],
  });
});

test('uses the generated aspect ratio for shape filtering', () => {
  const where = buildEagleFilterWhere(
    readEagleFilterQuery({
      version: 2,
      conditions: [
        {
          id: 'condition-1',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'rule-1', field: 'SHAPE', operator: 'EQUALS', value: 'SQUARE' }],
        },
      ],
    }),
  );
  assert.deepEqual(where, {
    AND: [{ AND: [{ aspectRatio: { gte: 0.95, lte: 1.05 } }] }],
  });
});
