import i18next, { type TOptions } from 'i18next';
import type { zhCN } from './messages/zh-CN';
import {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  setLocalePreference,
  type SupportedLocale,
} from './locale';

export type MessageId = keyof typeof zhCN;

const initialLocale = resolveLocale().locale;
// Only the active locale enters the first load; switching locales reloads the page.
// Tests and dev exercise both locales through tForLocale.
const resources =
  import.meta.env.MODE === 'test' || import.meta.env.DEV
    ? await Promise.all([import('./messages/zh-CN'), import('./messages/en-US')]).then(
        ([zh, en]) => ({
          'zh-CN': { translation: zh.zhCN },
          'en-US': { translation: en.enUS },
        }),
      )
    : {
        [initialLocale]: {
          translation:
            initialLocale === 'en-US'
              ? (await import('./messages/en-US')).enUS
              : (await import('./messages/zh-CN')).zhCN,
        },
      };

await i18next.init({
  lng: initialLocale,
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en-US'],
  resources,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  initAsync: false,
});

setDocumentLocale(initialLocale);

export function t(id: MessageId, options?: TOptions): string {
  return i18next.t(id, options);
}

export function tForLocale(locale: SupportedLocale, id: MessageId, options?: TOptions): string {
  return i18next.getFixedT(locale)(id, options);
}

export function getLocale(): SupportedLocale {
  return i18next.resolvedLanguage === 'en-US' ? 'en-US' : 'zh-CN';
}

export function setLocale(locale: SupportedLocale | null): void {
  setLocalePreference(locale);
  window.location.reload();
}

export function formatDateTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getLocale(), options).format(new Date(value));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

function setDocumentLocale(locale: SupportedLocale): void {
  document.documentElement.lang = locale;
}

declare global {
  interface Window {
    sekerEagleI18n?: {
      readonly locale: SupportedLocale;
      readonly preferenceKey: typeof LOCALE_STORAGE_KEY;
      setLocale: typeof setLocale;
    };
  }
}

window.sekerEagleI18n = Object.freeze({
  locale: getLocale(),
  preferenceKey: LOCALE_STORAGE_KEY,
  setLocale,
});
