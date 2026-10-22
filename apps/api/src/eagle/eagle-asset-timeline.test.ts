import assert from 'node:assert/strict';
import test from 'node:test';
import { readAssetTimeline } from './eagle-asset-timeline';

test('daily fast navigation scopes the complete library and uses the chosen date and timezone', async () => {
  for (const libraryMode of ['PHOTO', 'MATERIAL'] as const) {
    for (const sort of ['CAPTURED_AT', 'ADDED_AT'] as const) {
      let sql = '';
      let values: unknown[] = [];
      const db = {
        $queryRaw: async (q: { sql: string; values: unknown[] }) => {
          sql = q.sql;
          values = q.values;
          return [
            { day: '2026-10-21', boundary: new Date('2026-10-21T16:00:00Z'), count: 61n },
            { day: '2025-01-01', boundary: new Date('2025-01-01T16:00:00Z'), count: 4n },
          ];
        },
      };
      const result = await readAssetTimeline(
        db as never,
        { ownerId: 'owner-a', libraryMode },
        sort,
        'Asia/Shanghai',
      );
      assert.ok(sql.includes(sort === 'CAPTURED_AT' ? '"chronologicalAt"' : '"libraryAddedAt"'));
      assert.ok(sql.includes('"deletedAt" IS NULL'));
      assert.ok(sql.includes('"isPrivate" = false'));
      assert.ok(values.includes('owner-a'));
      assert.ok(values.includes(libraryMode));
      assert.ok(values.includes('Asia/Shanghai'));
      assert.equal(result.total, 65);
      assert.equal(result.days[1].offset, 61);
      assert.equal(result.days[0].before, '2026-10-21T16:00:00.000Z');
    }
  }
});

test('invalid timezone fails before querying storage', async () => {
  await assert.rejects(() =>
    readAssetTimeline(
      {} as never,
      { ownerId: 'owner', libraryMode: 'PHOTO' },
      'ADDED_AT',
      'not/a/timezone',
    ),
  );
});
