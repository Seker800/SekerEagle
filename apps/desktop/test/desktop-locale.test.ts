import { describe, expect, it } from 'vitest';
import { connectionPageUrl, desktopText, normalizeDesktopLocale } from '../src/main/desktop-locale';

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

  it('localizes native original-file dialogs without renderer-owned free text', () => {
    expect(desktopText('en-US', 'saveOriginalTitle')).toBe('Save Original File');
    expect(desktopText('en-US', 'save')).toBe('Save');
    expect(desktopText('en-US', 'downloadFolderTitle')).toBe('Choose Download Folder');
    expect(desktopText('en-US', 'downloadHere')).toBe('Download Here');
    expect(desktopText('zh-CN', 'saveOriginalTitle')).toBe('另存原文件');
  });
});
