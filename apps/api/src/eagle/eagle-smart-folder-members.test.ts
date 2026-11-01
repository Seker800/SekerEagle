import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMatchWithoutSemantic } from './eagle-smart-folder-members';

const semantic = { id: 'scene', field: 'SEMANTIC', operator: 'SIMILAR', value: '海' };
const ordinary = { id: 'tag', field: 'FORMAT', operator: 'EQUALS', value: 'jpg' };
test('only provable positive semantic requirements eliminate ordinary fallback', () => {
  const query = (match: string, result: string, rules: unknown[]) => ({
    version: 2,
    conditions: [{ id: 'g', match, result, rules }],
  });
  assert.equal(canMatchWithoutSemantic(query('ALL', 'MATCH', [semantic, ordinary])), false);
  assert.equal(canMatchWithoutSemantic(query('ANY', 'MATCH', [semantic])), false);
  assert.equal(canMatchWithoutSemantic(query('ANY', 'MATCH', [semantic, ordinary])), true);
  assert.equal(canMatchWithoutSemantic(query('ALL', 'NOT_MATCH', [semantic, ordinary])), true);
  assert.equal(
    canMatchWithoutSemantic({
      version: 2,
      conditions: [],
      semantic: { text: '海', breadth: 'BALANCED' },
    }),
    false,
  );
  assert.equal(canMatchWithoutSemantic({ version: 1, filters: { rating: 4 } }), true);
});
