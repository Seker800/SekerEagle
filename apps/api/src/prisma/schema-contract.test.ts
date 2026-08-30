import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';

async function schemaText(): Promise<string> {
  return readFile(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
}

async function scaleIndexMigrationText(): Promise<string> {
  return readFile(
    resolve(
      __dirname,
      '../../prisma/migrations/20260817103000_library_scale_indexes/migration.sql',
    ),
    'utf8',
  );
}

async function permanentPatMigrationText(): Promise<string> {
  return readFile(
    resolve(
      __dirname,
      '../../prisma/migrations/20260819143000_permanent_personal_access_tokens/migration.sql',
    ),
    'utf8',
  );
}

async function manualTagRecencyMigrationText(): Promise<string> {
  return readFile(
    resolve(__dirname, '../../prisma/migrations/20260829090000_manual_tag_last_used/migration.sql'),
    'utf8',
  );
}

async function aiNounTagMigrationText(): Promise<string> {
  return readFile(
    resolve(
      __dirname,
      '../../prisma/migrations/20260829140000_ai_noun_tag_semantics/migration.sql',
    ),
    'utf8',
  );
}

async function aiTagScheduleMigrationText(): Promise<string> {
  return readFile(
    resolve(
      __dirname,
      '../../prisma/migrations/20260829160000_ai_tag_schedule_settings/migration.sql',
    ),
    'utf8',
  );
}

async function aiTag8bMigrationText(): Promise<string> {
  return readFile(
    resolve(__dirname, '../../prisma/migrations/20260829173000_ai_tag_8b_instruct/migration.sql'),
    'utf8',
  );
}

void test('standalone schema excludes SekerChat domains', async () => {
  const schema = await schemaText();
  for (const forbidden of [
    'model Chat',
    'model Group',
    'model Reminder',
    'model Album',
    'model Bot',
  ]) {
    assert.equal(
      schema.includes(forbidden),
      false,
      `schema contains forbidden domain: ${forbidden}`,
    );
  }
});

void test('standalone schema contains independent auth and Eagle roots', async () => {
  const schema = await schemaText();
  for (const required of [
    'model User',
    'model RefreshToken',
    'model PersonalAccessToken',
    'model EagleAsset',
    'model EagleExternalLibrary',
    'model EagleImportRun',
  ]) {
    assert.equal(schema.includes(required), true, `schema is missing: ${required}`);
  }
});

void test('scale migration keeps active gallery ordering and color search indexable', async () => {
  const migration = await scaleIndexMigrationText();
  assert.match(
    migration,
    /ON "EagleAsset"\("ownerId", "libraryAddedAt" DESC, "id" DESC\)\s+WHERE "deletedAt" IS NULL/,
  );
  assert.match(migration, /ON "EagleAssetColorSwatch"\("ownerId", "labL", "labA", "labB"\)/);
});

void test('PAT schema and migration remove calendar expiry without removing revocation', async () => {
  const schema = await schemaText();
  const patModel = schema.match(/model PersonalAccessToken \{[\s\S]*?\n\}/)?.[0];
  assert.ok(patModel);
  assert.match(patModel, /expiresAt\s+DateTime\?/);
  assert.match(patModel, /revokedAt\s+DateTime\?/);

  const migration = await permanentPatMigrationText();
  assert.match(migration, /ALTER COLUMN "expiresAt" DROP NOT NULL/);
  assert.match(migration, /UPDATE "PersonalAccessToken"\s+SET "expiresAt" = NULL/);
  assert.doesNotMatch(migration, /SET "revokedAt"/);
});

void test('manual tag recency is owner-scoped and backfilled only from user assignments', async () => {
  const schema = await schemaText();
  const manualTagModel = schema.match(/model EagleManualTag \{[\s\S]*?\n\}/)?.[0];
  assert.match(manualTagModel ?? '', /lastUsedAt\s+DateTime\?/);
  assert.match(manualTagModel ?? '', /@@index\(\[ownerId, lastUsedAt\(sort: Desc\), id\]\)/);

  const migration = await manualTagRecencyMigrationText();
  assert.match(migration, /WHERE "assignedByUser" = true/);
  assert.match(migration, /tag\."ownerId" = recent\."ownerId"/);
  assert.match(migration, /"lastUsedAt" DESC/);
});

void test('AI tags share the versioned multimodal vector space and use cosine HNSW search', async () => {
  const schema = await schemaText();
  const aiTagModel = schema.match(/model EagleAiTag \{[\s\S]*?\n\}/)?.[0];
  assert.match(aiTagModel ?? '', /embeddingSpaceId\s+String\?/);
  assert.match(aiTagModel ?? '', /embedding\s+Unsupported\("vector\(1024\)"\)\?/);

  const migration = await aiNounTagMigrationText();
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'GENERATE_AI_TAGS'/);
  assert.match(migration, /USING hnsw \("embedding" vector_cosine_ops\)/);
});

void test('AI tag execution has independent manual and scheduled settings that default off', async () => {
  const schema = await schemaText();
  const settings = schema.match(/model EagleProcessingSetting \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(settings, /aiTagManualEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(settings, /aiTagScheduleEnabled\s+Boolean\s+@default\(false\)/);

  const migration = await aiTagScheduleMigrationText();
  assert.match(migration, /"aiTagManualEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /"aiTagScheduleStart" TEXT NOT NULL DEFAULT '23:00'/);
});

void test('8B AI tag migration upgrades queued work and supersedes stale retry records', async () => {
  const migration = await aiTag8bMigrationText();
  assert.match(migration, /UPDATE "EagleMediaJob"/);
  assert.match(migration, /"processorVersion" = 'ollama-concrete-nouns-8b-instruct-v2'/);
  assert.match(migration, /status = 'PENDING'/);
  assert.match(migration, /UPDATE "EagleAiAnalysisRun"/);
  assert.match(migration, /"promptVersion" = 'concrete-nouns-zh-v1'/);
  assert.match(migration, /status = 'SUPERSEDED'/);
});
