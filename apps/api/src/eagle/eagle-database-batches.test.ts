import assert from 'node:assert/strict';
import test from 'node:test';
import { DATABASE_PARAMETER_LIMIT, DATABASE_STATEMENTS, databaseBatches, databaseBatchSize } from './eagle-database-batches';

test('database batches cover empty, single, boundary and sixty thousand rows with stable offsets', () => {
  const statement = { fixedParameters: 7, parametersPerRow: 14, targetRows: 512 };
  for (const length of [0, 1, 511, 512, 513, 60000]) {
    const rows = Array.from({length}, (_, i) => i);
    const batches = [...databaseBatches(rows, statement)];
    assert.deepEqual(batches.flatMap((part) => part.rows), rows);
    for (const part of batches) assert.equal(part.rows[0], part.offset);
    assert.equal(batches.length, Math.ceil(length / 512));
  }
});
test('each statement clamps its real row width and fixed parameters even at an oversized work target', () => {
  for (const statement of Object.values(DATABASE_STATEMENTS)) {
    const wideTarget = { ...statement, targetRows: DATABASE_PARAMETER_LIMIT };
    const size = databaseBatchSize(wideTarget);
    assert.ok(size > 0);
    assert.ok(size * statement.parametersPerRow + statement.fixedParameters <= DATABASE_PARAMETER_LIMIT);
  }
  assert.equal(databaseBatchSize({fixedParameters: 9, parametersPerRow: 14, targetRows: 10000}), 2339);
  assert.equal(databaseBatchSize({fixedParameters: 20, parametersPerRow: 2, targetRows: 10000}), 10000);
});
test('invalid or impossible database budgets fail before yielding any partial work', () => {
  for (const statement of [
    {fixedParameters: -1, parametersPerRow: 1, targetRows: 1},
    {fixedParameters: 0, parametersPerRow: 0, targetRows: 1},
    {fixedParameters: 0, parametersPerRow: 1, targetRows: 0},
    {fixedParameters: 32767, parametersPerRow: 1, targetRows: 1},
    {fixedParameters: 1, parametersPerRow: 1.1, targetRows: 1},
  ]) assert.throws(() => [...databaseBatches([], statement)], /database statement budget/i);
});
test('global and appended verification ordinals remain stable across batch boundaries', () => {
  const values = Array.from({length: 1201}, (_, i) => i);
  for (const start of [0, 901]) {
    const ordinals = [...databaseBatches(values, DATABASE_STATEMENTS.duplicateOperationItems)]
      .flatMap(({offset, rows}) => rows.map((_, index) => start + offset + index));
    assert.deepEqual(ordinals, values.map((index) => start + index));
  }
});
