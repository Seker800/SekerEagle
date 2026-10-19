import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaLaneOrder, propagateFailedDependencies } from './job-recovery';
test('bounded fairness reserves maintenance and background turns without increasing decode concurrency', () => {
  const turns = Array.from({ length: 16 }, (_, i) => mediaLaneOrder(i)[0]);
  assert.equal(turns.filter((x) => x === 'MAINTENANCE').length, 1);
  assert.equal(turns.filter((x) => x === 'BACKGROUND').length, 3);
  assert.equal(turns.filter((x) => x === 'INTERACTIVE').length, 12);
});
test('dependency failure propagates recursively with owner and library joins', async () => {
  let sql = '';
  await propagateFailedDependencies({
    $executeRaw: async (query: unknown) => {
      sql = (query as { sql: string }).sql;
      return 3;
    },
  } as never);
  assert.match(sql, /WITH RECURSIVE/);
  assert.match(sql, /parent\."ownerId"=child\."ownerId"/);
  assert.match(sql, /parent\."libraryMode"=child\."libraryMode"/);
  assert.match(sql, /DEPENDENCY_FAILED/);
});
