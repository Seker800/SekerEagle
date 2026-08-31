import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  resolveLocale,
  setLocalePreference,
} from './locale';

describe('locale policy', () => {
  afterEach(() => window.localStorage.clear());

  it('normalizes supported Chinese and English locale variants', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('en-GB')).toBe('en-US');
    expect(normalizeLocale('fr-FR')).toBeNull();
  });

  it('prefers a persisted choice over URL and browser languages', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    expect(
      resolveLocale({ search: '?lang=en-US', browserLanguages: ['en-US'] }),
    ).toEqual({ locale: 'zh-CN', source: 'preference' });
  });

  it('uses a URL override without persisting it', () => {
    expect(resolveLocale({ search: '?lang=en', browserLanguages: ['zh-CN'] })).toEqual({
      locale: 'en-US',
      source: 'url',
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('falls back from browser languages to Chinese', () => {
    expect(resolveLocale({ search: '', browserLanguages: ['fr-FR', 'en-GB'] })).toEqual({
      locale: 'en-US',
      source: 'browser',
    });
    expect(resolveLocale({ search: '', browserLanguages: ['fr-FR'] })).toEqual({
      locale: 'zh-CN',
      source: 'fallback',
    });
  });

  it('persists only explicit supported preferences', () => {
    setLocalePreference('en-US');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
    setLocalePreference(null);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });
});
