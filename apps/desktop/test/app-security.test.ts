import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESKTOP_SERVER_URL, normalizeDesktopServerUrl } from '../src/main/app-config';
import { isAllowedAppNavigation } from '../src/main/navigation-policy';

describe('desktop server and navigation security', () => {
  it('uses the canonical local browser origin by default', () => {
    expect(DEFAULT_DESKTOP_SERVER_URL).toBe('http://localhost:8180');
  });

  it.each([
    ['http://127.0.0.1:8180', 'http://localhost:8180'],
    ['http://[::1]:8180', 'http://localhost:8180'],
    ['http://localhost:8180/', 'http://localhost:8180'],
    ['https://eagle.example.com/', 'https://eagle.example.com'],
  ])('accepts a trusted server origin: %s', (input, expected) => {
    expect(normalizeDesktopServerUrl(input)).toBe(expected);
  });

  it.each([
    'http://eagle.example.com',
    'file:///tmp/index.html',
    'https://user:password@example.com',
    'https://example.com/subpath',
    'https://example.com/?tenant=a',
    'http://192.168.31.89:8180',
  ])('rejects an unsafe server target: %s', (input) => {
    expect(() => normalizeDesktopServerUrl(input)).toThrow();
  });

  it('allows only exact-origin application navigation', () => {
    expect(isAllowedAppNavigation('https://eagle.example.com', 'https://eagle.example.com/')).toBe(
      true,
    );
    expect(
      isAllowedAppNavigation('https://eagle.example.com', 'https://eagle.example.com/account'),
    ).toBe(true);
    expect(
      isAllowedAppNavigation('https://eagle.example.com', 'https://attacker.example.com/'),
    ).toBe(false);
    expect(
      isAllowedAppNavigation('https://eagle.example.com', 'javascript:alert(document.cookie)'),
    ).toBe(false);
  });

  it('holds a single-instance cache writer lock and focuses the existing window', async () => {
    const source = await readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8');
    expect(source).toContain('app.requestSingleInstanceLock()');
    expect(source).toContain("app.on('second-instance'");
    expect(source).toMatch(/mainWindow\?\.focus\(\)/u);
  });

  it('expires authorization leases after a trusted offline-to-online transition', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(preload).toContain(".addEventListener('online'");
    expect(preload).toContain("ipcRenderer.send('desktop:network-online')");
    expect(main).toContain("ipcMain.on('desktop:network-online'");
    expect(main).toMatch(/assertTrustedIpcSender\(event\)[\s\S]*expireAuthorizations/u);
  });

  it('serves an offline connection manager and exposes only validated connection IPC', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("scheme: 'sekereagle-app'");
    expect(main).toContain("protocol.handle('sekereagle-app'");
    expect(main).toContain("ipcMain.handle('desktop:get-connection-status'");
    expect(main).toContain("ipcMain.handle('desktop:save-connections'");
    expect(main).toContain('assertTrustedConnectionSender(event)');
    expect(preload).toContain("ipcRenderer.invoke('desktop:open-connection-manager')");
    expect(preload).toContain("ipcRenderer.invoke('desktop:test-connections'");
    expect(preload).not.toContain('shell.openExternal');
  });
});
