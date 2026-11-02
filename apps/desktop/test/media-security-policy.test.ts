import { expect, it } from 'vitest';
import { desktopContentSecurityPolicy } from '../src/main/navigation-policy';

it('permits fetch only to the current server and the narrow media protocol, while keeping script restrictions', () => {
  const directives = desktopContentSecurityPolicy.split(';').map((part) => part.trim());
  expect(directives).toContain("connect-src 'self' sekereagle-media:");
  expect(directives).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(directives).toContain("object-src 'none'");
  expect(desktopContentSecurityPolicy).not.toContain("'unsafe-eval'");
  expect(desktopContentSecurityPolicy).not.toContain('*');
});
