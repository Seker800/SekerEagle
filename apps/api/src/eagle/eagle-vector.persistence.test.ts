import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshUnclassifiedSuggestions } from './eagle-vector.persistence';

test('refresh stays one SQL and compiles the shared review-evidence guard in the authenticated scope', async () => {
  let calls = 0;
  const result = await refreshUnclassifiedSuggestions(
    {
      $queryRaw: async (query: { sql: string; values: unknown[] }) => {
        calls++;
        assert.ok(query.sql.includes('reviewed."snapshotId"=candidate."snapshotId"'));
        assert.ok(query.sql.includes("reviewed.status IN ('ACCEPTED', 'REJECTED')"));
        assert.ok(query.sql.includes('asset."isPrivate" = false'));
        assert.ok(query.values.includes('owner'));
        assert.ok(query.values.includes('PHOTO'));
        assert.ok(query.values.includes('asset'));
        return [{ scanned: 1, matched: 0 }];
      },
    } as never,
    { ownerId: 'owner', libraryMode: 'PHOTO', assetIds: ['asset'] },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { scanned: 1, matched: 0 });
});

test('empty refresh selection performs no database work', async () => {
  assert.deepEqual(
    await refreshUnclassifiedSuggestions({} as never, { ownerId: 'owner', assetIds: [] }),
    { scanned: 0, matched: 0 },
  );
});
