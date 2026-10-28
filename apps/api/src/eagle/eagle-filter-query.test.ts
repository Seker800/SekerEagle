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

test('photography rules share the compiler and reject material mode', () => {
  const query = readEagleFilterQuery({
    version: 2,
    conditions: [
      {
        id: 'photo',
        match: 'ALL',
        result: 'MATCH',
        rules: [
          { id: 'camera', field: 'CAMERA_MODEL', operator: 'EQUALS', value: 'Test Camera' },
          { id: 'gps', field: 'GPS', operator: 'EQUALS', value: 'WITHOUT' },
        ],
      },
    ],
  });
  assert.throws(() => buildEagleFilterWhere(query), /摄影筛选/);
  const where = buildEagleFilterWhere(query, 'PHOTO');
  assert.match(JSON.stringify(where), /Test Camera/);
  assert.match(JSON.stringify(where), /null/);
});

test('ordinary rule compilation rejects semantic intent instead of silently broadening results', () => {
  assert.throws(
    () =>
      buildEagleFilterWhere({
        version: 2,
        conditions: [],
        semantic: { text: '海边', breadth: 'BALANCED' },
      }),
    /智能文件夹/,
  );
});

test('camera NOT_EMPTY excludes empty strings just as EMPTY includes them', () => {
  const query = readEagleFilterQuery({
    version: 2,
    conditions: [
      {
        id: 'g',
        match: 'ALL',
        result: 'MATCH',
        rules: [{ id: 'r', field: 'CAMERA_MODEL', operator: 'NOT_EMPTY' }],
      },
    ],
  });
  assert.deepEqual(buildEagleFilterWhere(query, 'PHOTO'), {
    AND: [
      {
        AND: [
          {
            photoMetadata: { is: { cameraModel: { not: null } } },
            NOT: { photoMetadata: { is: { cameraModel: '' } } },
          },
        ],
      },
    ],
  });
});

test('semantic predicates participate in ALL, ANY and group negation without escaping context', () => {
  for (const match of ['ALL', 'ANY'] as const)
    for (const result of ['MATCH', 'NOT_MATCH'] as const) {
      const query = readEagleFilterQuery({
        version: 2,
        conditions: [
          {
            id: 'g',
            match,
            result,
            rules: [
              {
                id: 'scene',
                field: 'SEMANTIC',
                operator: 'SIMILAR',
                value: '海边',
                breadth: 'BROAD',
              },
              { id: 'camera', field: 'CAMERA_MODEL', operator: 'EMPTY' },
            ],
          },
        ],
      });
      assert.throws(() => buildEagleFilterWhere(query, 'PHOTO'), /智能文件夹/);
      const scene = { id: { in: ['match'] } };
      const where = buildEagleFilterWhere(query, 'PHOTO', scene);
      const group = (where.AND as Record<string, unknown>[])[0]!;
      const expression = result === 'NOT_MATCH' ? (group.NOT as Record<string, unknown>) : group;
      assert.deepEqual((expression[match === 'ALL' ? 'AND' : 'OR'] as unknown[])[0], scene);
      assert.throws(() => buildEagleFilterWhere(query, 'MATERIAL', scene), /照片/);
    }
});
