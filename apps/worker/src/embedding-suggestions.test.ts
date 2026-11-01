import assert from 'node:assert/strict';
import test from 'node:test';
import { createTopEmbeddingSuggestion } from './embedding-suggestions';

test('suggestion publication keeps manual decisions and current vector evidence in its SQL guard', async () => {
  let sql = '';
  await createTopEmbeddingSuggestion(
    {
      $executeRaw: async (query: { sql: string }) => {
        sql = query.sql;
        return 1;
      },
    } as never,
    'owner',
    'PHOTO',
    'asset',
    'embedding',
    0.3,
  );
  for (const required of [
    'reviewedAt',
    'REJECTED',
    'ACCEPTED',
    'mediaRevision',
    'deletedAt',
    'storageTransferredOut',
    'isCurrent',
    "status = 'READY'",
    'recommendationEnabled',
  ])
    assert.ok(sql.includes(required), required);
});
