import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countActiveEagleFilterRules,
  createEmptyEagleFilterQuery,
  parseEagleFilterQuery,
} from './index';

test('smart-folder semantic intent survives parsing independently of ordinary rules', () => {
  assert.deepEqual(parseEagleFilterQuery({ version: 2, conditions: [],
    semantic: { text: '  海边日落  ', breadth: 'BALANCED' },
  }), { version: 2, conditions: [], semantic: { text: '海边日落', breadth: 'BALANCED' } });
});

test('semantic intent rejects empty, oversized, malformed and client-controlled vector inputs', () => {
  for (const semantic of [null, {}, { text: '', breadth: 'BALANCED' },
    { text: 'x'.repeat(501), breadth: 'BALANCED' }, { text: '海边', breadth: 'UNKNOWN' },
    { text: '海边', breadth: 'BALANCED', ownerId: 'someone' },
    { text: '海边', breadth: 'BALANCED', vector: [1, 0] }]) {
    assert.throws(() => parseEagleFilterQuery({ version: 2, conditions: [], semantic }));
  }
});

test('empty text rows are editable placeholders rather than active rules', () => {
  assert.equal(countActiveEagleFilterRules(createEmptyEagleFilterQuery()), 0);
});

test('parser rejects an operator that does not belong to the selected field', () => {
  assert.throws(
    () =>
      parseEagleFilterQuery({
        version: 2,
        conditions: [
          {
            id: 'condition-1',
            match: 'ALL',
            result: 'MATCH',
            rules: [{ id: 'rule-1', field: 'COLOR', operator: 'CONTAINS', value: '#ffffff' }],
          },
        ],
      }),
    /运算符无效/,
  );
});

test('parser preserves group negation and set values', () => {
  const query = parseEagleFilterQuery({
    version: 2,
    conditions: [
      {
        id: 'condition-1',
        match: 'ANY',
        result: 'NOT_MATCH',
        rules: [{ id: 'rule-1', field: 'MANUAL_TAGS', operator: 'ALL_OF', value: ['tag-1'] }],
      },
    ],
  });
  assert.equal(query.conditions[0]?.result, 'NOT_MATCH');
  assert.deepEqual(query.conditions[0]?.rules[0]?.value, ['tag-1']);
});
