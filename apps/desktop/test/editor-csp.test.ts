import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('allows the photo worker to compile WASM without allowing JavaScript eval or remote scripts', () => {
  const source = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  const policy = source.match(/"default-src 'self'; script-src[^"\n]+"/)?.[0];
  expect(policy).toBeDefined();
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toContain('https:');
  expect(policy).toContain("object-src 'none'");
});
