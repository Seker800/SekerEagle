export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'sekereagle.locale.v1';

export type LocaleSource = 'preference' | 'url' | 'browser' | 'fallback';

export interface ResolvedLocale {
  locale: SupportedLocale;
  source: LocaleSource;
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  return null;
}

export function resolveLocale({
  search = window.location.search,
  browserLanguages = navigator.languages,
}: {
  search?: string;
  browserLanguages?: readonly string[];
} = {}): ResolvedLocale {
  const preference = normalizeLocale(readLocalePreference());
  if (preference) return { locale: preference, source: 'preference' };

  const override = normalizeLocale(new URLSearchParams(search).get('lang'));
  if (override) return { locale: override, source: 'url' };

  for (const language of browserLanguages) {
    const locale = normalizeLocale(language);
    if (locale) return { locale, source: 'browser' };
  }
  return { locale: DEFAULT_LOCALE, source: 'fallback' };
}

export function setLocalePreference(locale: SupportedLocale | null): void {
  try {
    if (locale) window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    else window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // Language switching still works for the current URL when site storage is unavailable.
  }
}

function readLocalePreference(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}
