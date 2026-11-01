import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { unreviewedSuggestionEvidenceSql } from './vector-suggestion-evidence';

test('review evidence is scoped to owner, mode, intrinsic vector, tag and prototype snapshot', () => {
  const predicate = unreviewedSuggestionEvidenceSql(
    { ownerId: 'owner', libraryMode: 'PHOTO' },
    Prisma.sql`candidate."embeddingId"`,
    Prisma.sql`candidate."tagId"`,
    Prisma.sql`candidate."snapshotId"`,
  );
  assert.deepEqual(predicate.values, ['owner', 'PHOTO']);
  for (const field of ['embeddingId', 'suggestedTagId', 'snapshotId', 'reviewedAt'])
    assert.ok(predicate.sql.includes(field));
  assert.equal(predicate.sql.includes('generationId'), false);
});
