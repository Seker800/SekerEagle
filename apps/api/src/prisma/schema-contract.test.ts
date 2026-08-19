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
