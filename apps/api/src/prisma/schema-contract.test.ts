import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';

async function schemaText(): Promise<string> {
  return readFile(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
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
