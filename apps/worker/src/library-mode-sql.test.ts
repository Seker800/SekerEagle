import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

void test('worker raw SQL binds library modes as PostgreSQL enums across media and vector jobs', () => {
  let comparisons = 0;
  for (const file of sourceFiles(__dirname)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/"libraryMode"\s*=\s*\$\{[^}]+\}/g)) {
      comparisons++;
      const tail = source.slice(match.index! + match[0].length);
      assert.ok(tail.startsWith('::"LibraryMode"'), `Uncast enum parameter in ${file}: ${match[0]}`);
    }
  }
  assert.ok(comparisons > 0);
});
