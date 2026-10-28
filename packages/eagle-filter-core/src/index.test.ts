import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countActiveEagleFilterRules,
  editableEagleFilterQuery,
  readEagleSemanticIntent,
  createEmptyEagleFilterQuery,
  parseEagleFilterQuery,
} from './index';

test('smart-folder semantic intent survives parsing independently of ordinary rules', () => {
  assert.deepEqual(
    parseEagleFilterQuery({
      version: 2,
      conditions: [],
      semantic: { text: '  海边日落  ', breadth: 'BALANCED' },
    }),
    { version: 2, conditions: [], semantic: { text: '海边日落', breadth: 'BALANCED' } },
  );
});

test('semantic intent rejects empty, oversized, malformed and client-controlled vector inputs', () => {
  for (const semantic of [
    null,
    {},
    { text: '', breadth: 'BALANCED' },
    { text: 'x'.repeat(501), breadth: 'BALANCED' },
    { text: '海边', breadth: 'UNKNOWN' },
    { text: '海边', breadth: ['BALANCED'] },
    { text: '海边', breadth: 'BALANCED', ownerId: 'someone' },
    { text: '海边', breadth: 'BALANCED', vector: [1, 0] },
  ]) {
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

test('semantic content is a composable rule with a validated matching breadth', () => {
  const query = parseEagleFilterQuery({
    version: 2,
    conditions: [
      {
        id: 'group',
        match: 'ANY',
        result: 'NOT_MATCH',
        rules: [
          { id: 'scene', field: 'SEMANTIC', operator: 'SIMILAR', value: '海边', breadth: 'STRICT' },
          { id: 'camera', field: 'CAMERA_MODEL', operator: 'EMPTY' },
        ],
      },
    ],
  });
  assert.equal(countActiveEagleFilterRules(query), 2);
  assert.equal(query.conditions[0]!.rules[0]!.field, 'SEMANTIC');
  assert.throws(() =>
    parseEagleFilterQuery({
      ...query,
      conditions: [
        {
          ...query.conditions[0],
          rules: [{ ...query.conditions[0]!.rules[0], breadth: 'INVALID' }],
        },
      ],
    }),
  );
});

test('legacy scenes become an extra AND group while ordinary group semantics survive', () => {
  const old = parseEagleFilterQuery({
    version: 2,
    semantic: { text: '海边', breadth: 'STRICT' },
    conditions: [
      {
        id: 'g',
        match: 'ANY',
        result: 'NOT_MATCH',
        rules: [{ id: 'r', field: 'FORMAT', operator: 'EQUALS', value: 'png' }],
      },
    ],
  });
  const edited = editableEagleFilterQuery(old);
  assert.equal(edited.semantic, undefined);
  assert.deepEqual(edited.conditions[0], old.conditions[0]);
  assert.deepEqual(readEagleSemanticIntent(edited), old.semantic);
  assert.deepEqual(parseEagleFilterQuery(edited), edited);
});

test('scene contract rejects duplicate intents and accepts an inactive blank editor row', () => {
  const blank = { id: 'r', field: 'SEMANTIC', operator: 'SIMILAR', value: '', breadth: 'BALANCED' };
  const query = {
    version: 2,
    conditions: [{ id: 'g', match: 'ALL', result: 'MATCH', rules: [blank] }],
  };
  assert.equal(readEagleSemanticIntent(parseEagleFilterQuery(query)), undefined);
  assert.throws(
    () => parseEagleFilterQuery({ ...query, semantic: { text: '海边', breadth: 'STRICT' } }),
    /一条/,
  );
  assert.throws(
    () =>
      parseEagleFilterQuery({
        ...query,
        conditions: [{ ...query.conditions[0], rules: [blank, { ...blank, id: 'r2' }] }],
      }),
    /一条/,
  );
});

test('editing a legacy scene retains all thirty existing condition groups', () => {
  const legacy = parseEagleFilterQuery({
    version: 2,
    semantic: { text: '海边', breadth: 'BALANCED' },
    conditions: Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`,
      match: 'ANY',
      result: 'MATCH',
      rules: [{ id: `r${i}`, field: 'NAME', operator: 'CONTAINS', value: 'x' }],
    })),
  });
  const edited = editableEagleFilterQuery(legacy);
  assert.equal(parseEagleFilterQuery(edited).conditions.length, 31);
  assert.throws(
    () =>
      parseEagleFilterQuery({
        ...edited,
        conditions: [...edited.conditions, edited.conditions[0]],
      }),
    /条件组/,
  );
});


test('changing a migrated scene to an ordinary field preserves a valid 31-group query', () => {
  const legacy = parseEagleFilterQuery({ version: 2, semantic: { text: '海边', breadth: 'BALANCED' }, conditions: Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, match: 'ANY', result: 'MATCH', rules: [{ id: `r${i}`, field: 'NAME', operator: 'CONTAINS', value: 'x' }] })) });
  const edited = editableEagleFilterQuery(legacy);
  edited.conditions[30]!.rules = [{ id: 'changed', field: 'NAME', operator: 'CONTAINS', value: '海边' }];
  assert.equal(parseEagleFilterQuery(edited).conditions.length, 31);
  assert.throws(() => parseEagleFilterQuery({ ...edited, semantic: { text: '海边', breadth: 'BALANCED' } }), /条件组/);
});
