import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countActiveEagleFilterRules,
  createEmptyEagleFilterQuery,
  parseEagleFilterQuery,
} from './index';

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
