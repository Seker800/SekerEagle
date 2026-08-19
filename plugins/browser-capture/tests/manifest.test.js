import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ships a minimal Manifest V3 extension with durable queue permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.1.4');
  assert.equal(manifest.background.service_worker, 'src/service-worker.js');
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: ['src/capture-interaction.js', 'src/image-source-resolver.js'],
      matches: ['<all_urls>'],
    },
  ]);
  assert.equal(manifest.content_security_policy.extension_pages.includes('http'), false);
});

test('uses the same PAT prefix as the SekerEagle authentication boundary', async () => {
  const authConstants = await readFile(
    new URL('../../../apps/api/src/auth/auth.constants.ts', import.meta.url),
    'utf8',
  );
  const extensionSurfaces = await Promise.all(
    ['../src/api-client.js', '../src/options.js', '../src/queue-runner.js', '../options.html'].map(
      (path) => readFile(new URL(path, import.meta.url), 'utf8'),
    ),
  );

  assert.match(authConstants, /PAT_PREFIX = 'sea_pat_'/);
  for (const source of extensionSurfaces) {
    assert.match(source, /sea_pat_/);
    assert.doesNotMatch(source, /seg_pat_/);
  }
});
