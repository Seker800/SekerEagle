import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTopEmbeddingSuggestion,
  activateEmbeddingSuggestionGeneration,
} from './embedding-suggestions';

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

test('generation activation revalidates staged evidence after an owner can review it', async () => {
  let sql = '';
  await activateEmbeddingSuggestionGeneration(
    {
      $executeRaw: async (query: { sql: string }) => {
        sql = query.sql;
        return 0;
      },
    } as never,
    { ownerId: 'owner', libraryMode: 'PHOTO' },
    'generation',
  );
  for (const required of [
    'reviewedAt',
    'REJECTED',
    'ACCEPTED',
    'mediaRevision',
    'deletedAt',
    'storageTransferredOut',
    'recommendationEnabled',
    'generationId',
  ])
    assert.ok(sql.includes(required), required);
});
