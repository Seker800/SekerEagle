import { expect, it } from 'vitest';
import {
  desktopContentSecurityPolicy,
  isAllowedMediaOrigin,
  mediaCorsHeaders,
} from '../src/main/navigation-policy';

it('permits fetch only to the current server and the narrow media protocol, while keeping script restrictions', () => {
  const directives = desktopContentSecurityPolicy.split(';').map((part) => part.trim());
  expect(directives).toContain("connect-src 'self' sekereagle-media:");
  expect(directives).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(directives).toContain("object-src 'none'");
  expect(desktopContentSecurityPolicy).not.toContain("'unsafe-eval'");
  expect(desktopContentSecurityPolicy).not.toContain('*');
});

it('grants media reads only to the exact connected server and preserves legacy image requests', () => {
  expect(isAllowedMediaOrigin('https://example.com:8181', 'https://example.com:8181')).toBe(true);
  expect(isAllowedMediaOrigin('https://example.com:8181', null)).toBe(true);
  for (const origin of [
    'null',
    'https://attacker.invalid',
    'https://example.com',
    'http://example.com:8181',
  ])
    expect(isAllowedMediaOrigin('https://example.com:8181', origin)).toBe(false);
  expect(mediaCorsHeaders('https://example.com:8181')['access-control-allow-origin']).toBe(
    'https://example.com:8181',
  );
});
