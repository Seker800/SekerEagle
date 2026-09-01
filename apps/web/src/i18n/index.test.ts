import { afterEach, describe, expect, it, vi } from 'vitest';

describe('web internationalization bootstrap', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    window.localStorage.setItem('sekereagle.locale.v1', 'zh-CN');
    vi.resetModules();
  });

  it('boots directly into English from the hidden URL override', async () => {
    window.localStorage.removeItem('sekereagle.locale.v1');
    window.history.replaceState({}, '', '/?lang=en-US');
    vi.resetModules();

    const { getLocale, t } = await import('./index');

    expect(getLocale()).toBe('en-US');
    expect(t('登录素材库')).toBe('Sign in to your library');
    expect(document.documentElement.lang).toBe('en-US');
    expect(window.sekerEagleI18n?.locale).toBe('en-US');
  });

  it('keeps Chinese as the safe fallback for unsupported browser languages', async () => {
    window.localStorage.removeItem('sekereagle.locale.v1');
    Object.defineProperty(window.navigator, 'languages', {
      configurable: true,
      value: ['fr-FR'],
    });
    vi.resetModules();

    const { getLocale, t } = await import('./index');

    expect(getLocale()).toBe('zh-CN');
    expect(t('登录素材库')).toBe('登录素材库');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
