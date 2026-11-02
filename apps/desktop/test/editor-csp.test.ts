import { desktopContentSecurityPolicy } from '../src/main/navigation-policy';
import { expect, it } from 'vitest';

it('allows the photo worker to compile WASM without allowing JavaScript eval or remote scripts', () => {
  const policy = desktopContentSecurityPolicy;
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toContain('https:');
  expect(policy).toContain("object-src 'none'");
});
