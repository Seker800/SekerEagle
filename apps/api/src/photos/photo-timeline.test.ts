import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhotoManagementService } from './photo-management.service';
import { decodeEagleAssetCursor } from '../eagle/eagle-cursor';

test('timeline aggregates only this owner PHOTO library and hides private rows by default', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const service = new PhotoManagementService({
    $queryRaw: async (query: { text: string; values: unknown[] }) => {
      queries.push(query);
      return [{ month: new Date('2024-12-01T00:00:00Z'), count: 123n }];
    },
  } as never);
  const result = await service.timeline('owner-1', false);
  assert.match(queries[0]!.text, /"libraryMode" = 'PHOTO'/);
  assert.match(queries[0]!.text, /"ownerId" = \$/);
  assert.match(queries[0]!.text, /"deletedAt" IS NULL/);
  assert.match(queries[0]!.text, /"isPrivate" = false/);
  assert.ok(queries[0]!.values.includes('owner-1'));
  assert.equal(result.months[0]!.month, '2024-12');
  assert.equal(result.months[0]!.count, 123);
  const decoded = decodeEagleAssetCursor(result.months[0]!.cursor, {
    ownerId: 'owner-1',
    libraryMode: 'PHOTO',
  });
  assert.equal(decoded.libraryAddedAt.toISOString(), '2025-01-01T00:00:00.000Z');
  assert.throws(() =>
    decodeEagleAssetCursor(result.months[0]!.cursor, { ownerId: 'owner-2', libraryMode: 'PHOTO' }),
  );
  assert.throws(() =>
    decodeEagleAssetCursor(result.months[0]!.cursor, {
      ownerId: 'owner-1',
      libraryMode: 'MATERIAL',
    }),
  );
  await service.timeline('owner-1', true);
  assert.doesNotMatch(queries[1]!.text, /"isPrivate" = false/);
});
