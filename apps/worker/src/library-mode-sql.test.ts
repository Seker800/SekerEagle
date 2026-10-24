import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('worker raw SQL binds library modes as PostgreSQL enums across media and vector jobs', () => {
  const source = readFileSync(`${__dirname}/main.ts`, 'utf8');
  const comparisons = [...source.matchAll(/"libraryMode"\s*=\s*\$\{[^}]+\}/g)];
  assert.ok(comparisons.length > 0);
  for (const match of comparisons) {
    const tail = source.slice(match.index! + match[0].length);
    assert.ok(tail.startsWith('::"LibraryMode"'), `Uncast enum parameter: ${match[0]}`);
  }
});
