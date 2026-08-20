import { describe, expect, it } from 'vitest';
import { normalizeDesktopServerUrl } from '../src/main/app-config';
import { isAllowedAppNavigation } from '../src/main/navigation-policy';

describe('desktop server and navigation security', () => {
  it.each([
    ['http://127.0.0.1:8180', 'http://127.0.0.1:8180'],
    ['http://localhost:8180/', 'http://localhost:8180'],
    ['https://eagle.example.com/', 'https://eagle.example.com'],
  ])('accepts a trusted server origin: %s', (input, expected) => {
    expect(normalizeDesktopServerUrl(input)).toBe(expected);
  });

  it.each([
    'http://eagle.example.com',
    'file:///tmp/index.html',
    'https://user:password@example.com',
    'https://example.com/subpath',
    'https://example.com/?tenant=a',
    'http://192.168.31.89:8180',
  ])('rejects an unsafe server target: %s', (input) => {
    expect(() => normalizeDesktopServerUrl(input)).toThrow();
  });

  it('allows only exact-origin application navigation', () => {
    expect(isAllowedAppNavigation('https://eagle.example.com', 'https://eagle.example.com/')).toBe(
      true,
    );
    expect(
      isAllowedAppNavigation('https://eagle.example.com', 'https://eagle.example.com/account'),
    ).toBe(true);
    expect(
      isAllowedAppNavigation('https://eagle.example.com', 'https://attacker.example.com/'),
    ).toBe(false);
    expect(
      isAllowedAppNavigation('https://eagle.example.com', 'javascript:alert(document.cookie)'),
    ).toBe(false);
  });
});
