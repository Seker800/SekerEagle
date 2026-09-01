import i18next, { type TOptions } from 'i18next';
import { enUS } from './messages/en-US';
import { zhCN } from './messages/zh-CN';
import {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  setLocalePreference,
  type SupportedLocale,
} from './locale';

export type MessageId = keyof typeof zhCN;

const initialLocale = resolveLocale().locale;

void i18next.init({
  lng: initialLocale,
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en-US'],
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
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
