import { describe, expect, it } from 'vitest';
import { connectionPageUrl, normalizeDesktopLocale } from '../src/main/desktop-locale';

describe('desktop locale policy', () => {
  it('normalizes English and Chinese locale variants with a Chinese fallback', () => {
    expect(normalizeDesktopLocale('en-GB')).toBe('en-US');
    expect(normalizeDesktopLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeDesktopLocale('fr-FR')).toBe('zh-CN');
  });

  it('passes the selected locale to the isolated connection page', () => {
    expect(connectionPageUrl('en-US')).toBe('sekereagle-app://connection/?lang=en-US');
    expect(connectionPageUrl('zh-CN')).toBe('sekereagle-app://connection/?lang=zh-CN');
  });
});
