import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Frozen old API timer providers, not a reimplementation of their lifecycle or SQL. */
export async function loadLegacyApiBackground() {
  const fixtures = new URL('./fixtures/legacy-api-background/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', fixtures), 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'eagle-legacy-background-'));
  const legacy = {};
  try {
    for (const [filename, sha256] of Object.entries(manifest.files)) {
      const source = await readFile(new URL(filename, fixtures), 'utf8');
      assert.equal(createHash('sha256').update(source).digest('hex'), sha256);
      const resolve = createRequire(
        new URL(`../../apps/api/dist/eagle/${filename.replace('.source', '')}`, import.meta.url),
      );
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      }).outputText;
      // Only module locations change. The fixed snapshot's methods and timers are untouched.
      const linked = compiled.replace(
        /(from\s+['"])([^'"]+)(['"])/g,
        (_all, before, specifier, after) =>
          `${before}${pathToFileURL(resolve.resolve(specifier)).href}${after}`,
      );
      const file = join(directory, filename.replace('.ts.source', '.mjs'));
      await writeFile(file, linked);
      Object.assign(legacy, await import(pathToFileURL(file).href));
    }
    return { ...legacy, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
