export type DesktopLocale = 'zh-CN' | 'en-US';

export function normalizeDesktopLocale(value: unknown): DesktopLocale {
  if (typeof value !== 'string') return 'zh-CN';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  return 'zh-CN';
}

export function connectionPageUrl(locale: DesktopLocale): string {
  const url = new URL('sekereagle-app://connection/');
  url.searchParams.set('lang', locale);
  return url.toString();
}
