import { describe, expect, it } from 'vitest';
import { desktopCacheRoot } from '../src/main/cache-location';

describe('desktop cache location', () => {
  it('uses the standard macOS user cache directory', () => {
    expect(desktopCacheRoot({ platform: 'darwin', home: '/Users/test', appData: '/ignored' })).toBe(
      '/Users/test/Library/Caches/SekerEagle/MediaCache/v2',
    );
  });

  it('keeps Windows package-ready with LocalAppData and rejects relative overrides', () => {
    expect(
      desktopCacheRoot({
        platform: 'win32',
        home: 'C:\\Users\\test',
        appData: 'C:\\Users\\test\\AppData\\Roaming',
        localAppData: 'C:\\Users\\test\\AppData\\Local',
      }),
    ).toContain('AppData');
    expect(
      desktopCacheRoot({
        platform: 'linux',
        home: '/home/test',
        appData: '/ignored',
        xdgCacheHome: 'relative-cache',
      }),
    ).toBe('/home/test/.cache/SekerEagle/MediaCache/v2');
  });
});
