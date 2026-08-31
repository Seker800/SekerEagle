export type DesktopLocale = 'zh-CN' | 'en-US';

const DESKTOP_MESSAGES = {
  'zh-CN': {
    saveOriginalTitle: '另存原文件',
    save: '保存',
    downloadFolderTitle: '选择批量下载文件夹',
    downloadHere: '下载到此处',
  },
  'en-US': {
    saveOriginalTitle: 'Save Original File',
    save: 'Save',
    downloadFolderTitle: 'Choose Download Folder',
    downloadHere: 'Download Here',
  },
} as const;

export type DesktopMessageKey = keyof (typeof DESKTOP_MESSAGES)['zh-CN'];

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

export function desktopText(locale: DesktopLocale, key: DesktopMessageKey): string {
  return DESKTOP_MESSAGES[locale][key];
}
