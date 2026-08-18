import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const schemaUrl = resolve(process.cwd(), 'prisma/schema.prisma');
const migrationUrl = resolve(
  process.cwd(),
  'prisma/migrations/20260819001000_vector_tag_suggestions/migration.sql',
);

test('vector schema keeps recommendation opt-in and suggestions separate from AI tags', async () => {
  const schema = await readFile(schemaUrl, 'utf8');
  assert.match(schema, /model EagleManualTagSemanticConfig[\s\S]*recommendationEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /model EagleVectorTagSuggestion/);
  assert.match(schema, /status\s+EagleVectorSuggestionStatus\s+@default\(PENDING\)/);
  assert.doesNotMatch(
    schema.match(/model EagleVectorTagSuggestion \{[\s\S]*?\n\}/)?.[0] ?? '',
    /EagleAiTag|EagleAssetAiTag/,
  );
});

test('pgvector migration is additive, owner-scoped and fixes the embedding dimension', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(migration, /vector\(1024\)/);
  assert.match(migration, /DEFAULT false/);
  assert.match(migration, /FOREIGN KEY \("ownerId", "assetId"\)/);
  assert.match(migration, /FOREIGN KEY \("ownerId", "tagId"\)/);
  assert.match(migration, /WHERE "isCurrent" = true/);
  assert.match(migration, /vector_cosine_ops/);
  const suggestionTable = migration.match(
    /CREATE TABLE "EagleVectorTagSuggestion" \([\s\S]*?\n\);/,
  )?.[0];
  assert.match(suggestionTable ?? '', /"isActive" BOOLEAN NOT NULL DEFAULT false/);
});
