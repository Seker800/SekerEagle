import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readManifest = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('API pretest builds every internal runtime dependency before loading tests', async () => {
  const apiManifest = await readManifest('apps/api/package.json');
  const internalRuntimeDependencies = Object.keys(apiManifest.dependencies ?? {}).filter((name) =>
    name.startsWith('@sekereagle/'),
  );

  assert.ok(internalRuntimeDependencies.length > 0, 'expected API workspace dependencies');

  for (const dependency of internalRuntimeDependencies) {
    assert.match(
      apiManifest.scripts?.pretest ?? '',
      new RegExp(`--workspace ${dependency.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?: |$)`),
      `API pretest must build ${dependency} for a clean checkout`,
    );
  }
});
