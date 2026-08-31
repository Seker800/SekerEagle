import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_STORAGE_KEY, normalizeLocale, resolveLocale, setLocalePreference } from './locale';

describe('locale policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('normalizes supported Chinese and English locale variants', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('en-GB')).toBe('en-US');
    expect(normalizeLocale('fr-FR')).toBeNull();
  });

  it('lets the explicit URL temporarily override a persisted choice', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    expect(resolveLocale({ search: '?lang=en-US', browserLanguages: ['en-US'] })).toEqual({
      locale: 'en-US',
      source: 'url',
    });
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

  it('continues resolving and switching when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });

    expect(resolveLocale({ search: '?lang=en-US', browserLanguages: ['zh-CN'] })).toEqual({
      locale: 'en-US',
      source: 'url',
    });

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });
    expect(() => setLocalePreference('en-US')).not.toThrow();
  });
});
