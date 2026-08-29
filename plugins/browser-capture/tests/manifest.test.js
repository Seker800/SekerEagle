import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ships a minimal Manifest V3 extension with durable queue permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.3.0');
  assert.equal(manifest.name, 'SekerEagle 灵感采集');
  assert.equal(manifest.background.service_worker, 'src/service-worker.js');
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'notifications', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.deepEqual(manifest.content_scripts[0].js, ['src/x-media-page-observer.js']);
  assert.equal(manifest.content_scripts[1].run_at, 'document_start');
  assert.equal(manifest.content_scripts[1].all_frames, true);
  assert.deepEqual(manifest.content_scripts[1].js, [
    'src/site-media-observer.js',
    'src/content-script.js',
  ]);
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: [
        'src/capture-interaction.js',
        'src/image-source-resolver.js',
        'src/video-source-resolver.js',
      ],
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
