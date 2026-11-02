import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditRenderLut } from './edit-render-lut';
const row = {
  ownerId: 'owner',
  libraryMode: 'PHOTO' as const,
  lut: null,
  commandOperationId: 'operation',
};

test('worker projects only the exact table with scoped parameterized SQL and clipboard selection rules', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push(query);
      return [{ lut: 'selected-table', payloadExists: true, recipeMatches: false }];
    },
    eagleAssetOperation: {
      findFirst: () => {
        throw new Error('whole bank must not cross the database boundary');
      },
    },
  };
  assert.equal(await resolveEditRenderLut(db as never, row, 'lut:target'), 'selected-table');
  assert.equal(queries.length, 1);
  const query = queries[0]!;
  assert.match(query.sql, /CASE/);
  assert.match(query.sql, /jsonb_typeof/);
  assert.match(query.sql, /IS DISTINCT FROM 'false'/);
  assert.match(query.sql, /"ownerId"=/);
  assert.match(query.sql, /"libraryMode"=/);
  assert.match(query.sql, /kind='METADATA_COMMAND'/);
  assert.ok(
    query.values.includes('operation') &&
      query.values.includes('owner') &&
      query.values.includes('PHOTO') &&
      query.values.includes('lut:target'),
  );
  assert.doesNotMatch(query.sql, /SELECT\s+"commandPayload"/);
});
test('worker fails closed for missing operation, unavailable table, nonstring projection and wrong target filter', async () => {
  for (const records of [
    [],
    [{ lut: null, payloadExists: false, recipeMatches: null }],
    [{ lut: 8, payloadExists: true, recipeMatches: true }],
    [{ lut: null, payloadExists: true, recipeMatches: false }],
  ]) {
    const db = { $queryRaw: async () => records };
    await assert.rejects(resolveEditRenderLut(db as never, row, 'lut:target'));
  }
  await assert.rejects(
    resolveEditRenderLut({} as never, { ...row, lut: 'inline' }, 'lut:target'),
    /EDIT_LUT_REFERENCE_INVALID/,
  );
});
test('worker retains inline LUT compatibility without querying the bank and rejects missing custom LUT', async () => {
  assert.equal(
    await resolveEditRenderLut(
      {} as never,
      { ...row, commandOperationId: null, lut: 'inline' },
      'lut:legacy',
    ),
    'inline',
  );
  await assert.rejects(
    resolveEditRenderLut({} as never, { ...row, commandOperationId: null }, 'lut:legacy'),
    /EDIT_LUT_MISSING/,
  );
});
