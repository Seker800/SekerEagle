import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTransferFacts } from './eagle-transfer-facts';

test('a transferred vector is preserved off-index and schedules normal background activation', async () => {
  let vectorSql = '';
  const result = await copyTransferFacts(
    {
      eagleAssetTransferFacts: { create: async () => ({}) },
      $queryRaw: async (sql: { sql: string }) => {
        vectorSql = sql.sql;
        return [{ id: 'pending-vector' }];
      },
      $executeRaw: async () => {
        throw new Error('SEND must not match smart folders or write the HNSW index');
      },
    } as never,
    'owner',
    'MATERIAL',
    'target',
    { id: 'source', libraryMode: 'PHOTO', mediaRevision: 1 } as never,
    true,
  );
  assert.match(vectorSql, /'PENDING',false/);
  assert.equal(
    result.embeddingReady,
    false,
    'the existing embedding job must activate the copied vector',
  );
});
