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

test('library integration builds media-core before API and worker on a clean checkout', async () => {
  const manifest = await readManifest('package.json');
  const command = manifest.scripts['test:library-integration'];
  assert.ok(command.includes('--workspace @sekereagle/media-core'));
  assert.ok(
    command.indexOf('--workspace @sekereagle/media-core') <
      command.indexOf('--workspace @sekereagle/api'),
  );
});

test('backend persistence types resolve without generated workspace dist files', async () => {
  const { default: ts } = await import('typescript');
  const { resolve } = await import('node:path');
  const host = {
    ...ts.sys,
    fileExists: (path) => !/library-persistence\/dist\//.test(path) && ts.sys.fileExists(path),
  };
  const resolution = ts.resolveModuleName(
    '@sekereagle/library-persistence',
    resolve('apps/api/src/eagle/eagle-privacy.service.ts'),
    { moduleResolution: ts.ModuleResolutionKind.Node10 },
    host,
  );
  assert.ok(
    resolution.resolvedModule?.resolvedFileName.endsWith('.ts'),
    'clean checkout must resolve persistence types before build',
  );
});
