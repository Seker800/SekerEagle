import assert from 'node:assert/strict';
import test from 'node:test';
import { readMediaProcessingFacts } from './media-processing-facts';

test('basic browsing readiness does not require a RAW edit derivative and keeps owner, mode and version fences', async () => {
  let query = { sql: '', values: [] as unknown[] };
  await readMediaProcessingFacts(
    {
      $queryRaw: async (input: typeof query) => {
        query = input;
        return [];
      },
    } as never,
    'owner',
    'PHOTO',
    ['asset'],
  );
  const browsing = query.sql.slice(0, query.sql.indexOf('AS "renditionsReady"'));
  assert.doesNotMatch(browsing, /variant='edit'/);
  assert.ok(query.values.includes('owner'));
  assert.ok(query.values.includes('PHOTO'));
  assert.ok(query.values.includes('asset'));
  assert.match(query.sql, /mediaRevision/);
  assert.match(query.sql, /deletedAt/);
});
