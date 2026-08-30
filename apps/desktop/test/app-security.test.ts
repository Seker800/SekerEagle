import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESKTOP_SERVER_URL, normalizeDesktopServerUrl } from '../src/main/app-config';
import { isAllowedAppNavigation } from '../src/main/navigation-policy';

describe('desktop server and navigation security', () => {
  it('redirects portable profile data before acquiring the single-instance lock', async () => {
    const main = await readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8');
    expect(main.indexOf("app.setPath('userData'")).toBeGreaterThan(-1);
    expect(main.indexOf("app.setPath('userData'")).toBeLessThan(
      main.indexOf('app.requestSingleInstanceLock()'),
    );
  });

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

  it('propagates custom-protocol cancellation into media resolution', async () => {
    const source = await readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8');
    expect(source).toContain('handleMediaRequest(request.url, request.signal)');
    expect(source).toContain('mediaController.resolve(requestUrl, signal)');
    expect(source).toContain('options.signal');
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
    expect(main).toMatch(
      /desktop:reset-deployment-binding'[\s\S]{0,180}assertConnectionPageSender\(event\)/u,
    );
    expect(preload).toContain("ipcRenderer.invoke('desktop:open-connection-manager')");
    expect(preload).toContain("ipcRenderer.invoke('desktop:test-connections'");
    expect(preload).not.toContain('shell.openExternal');
  });

  it('exposes cache management only through sender-validated desktop IPC', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toMatch(
      /desktop:get-cache-manager-status'[\s\S]{0,180}assertConnectionPageSender\(event\)/u,
    );
    expect(main).toMatch(
      /desktop:open-cache-folder'[\s\S]{0,180}assertConnectionPageSender\(event\)/u,
    );
    expect(preload).toContain("ipcRenderer.invoke('desktop:get-cache-manager-status')");
    expect(preload).toContain("ipcRenderer.invoke('desktop:open-cache-folder')");
  });

  it('writes only bounded PNG payloads through sender-validated clipboard IPC', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("ipcMain.handle('desktop:write-clipboard-image'");
    expect(main).toMatch(
      /desktop:write-clipboard-image'[\s\S]{0,180}assertTrustedIpcSender\(event\)/u,
    );
    expect(main).toContain('parseClipboardImageInput(input)');
    expect(preload).toContain("contentType: 'image/png'");
    expect(preload).toContain("ipcRenderer.invoke('desktop:write-clipboard-image'");
  });

  it('prepares and starts native original-file drags only through trusted capabilities', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("ipcMain.handle('desktop:prepare-asset-drag'");
    expect(main).toMatch(
      /desktop:prepare-asset-drag'[\s\S]{0,240}assertTrustedIpcSender\(event\)/u,
    );
    expect(main).toContain("ipcMain.on('desktop:start-prepared-asset-drag'");
    expect(main).toContain('parseAssetDragInput(input)');
    expect(main).toContain('webContents.startDrag');
    expect(main).toContain('dragServerUrl !== serverUrl');
    expect(main).toContain('currentIdentity.ownerId !== identity.ownerId');
    expect(main).toContain("app.getFileIcon(prepared.files[0], { size: 'normal' })");
    expect(main).toContain('startNativeDrag(event, entry.prepared, entry.icon)');
    expect(preload).toContain('parseAssetDragInput(assetIds)');
    expect(preload).toMatch(/ipcRenderer\.invoke\(\s*'desktop:prepare-asset-drag'/u);
    expect(preload).toContain('parsePreparedDragToken(result.token)');
    expect(preload).toContain("ipcRenderer.send('desktop:start-prepared-asset-drag'");
    expect(preload).not.toContain('filePath');
  });

  it('saves one authenticated original only through a native Save As dialog', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("ipcMain.handle('desktop:save-original-file'");
    expect(main).toMatch(
      /desktop:save-original-file'[\s\S]{0,240}assertTrustedIpcSender\(event\)/u,
    );
    expect(main).toContain('parseAssetDragInput([input])');
    expect(main).toContain('dialog.showSaveDialog');
    expect(main).toContain('copyFile(prepared.files[0], result.filePath)');
    expect(main).toContain('currentIdentity.ownerId !== identity.ownerId');
    expect(preload).toMatch(/ipcRenderer\.invoke\(\s*'desktop:save-original-file'/u);
    expect(preload).toContain('parseAssetDragInput([assetId])');
  });

  it('downloads a validated original batch only into a native-selected directory', async () => {
    const [main, preload] = await Promise.all([
      readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("ipcMain.handle('desktop:download-original-files'");
    expect(main).toMatch(
      /desktop:download-original-files'[\s\S]{0,240}assertTrustedIpcSender\(event\)/u,
    );
    expect(main).toContain("properties: ['openDirectory', 'createDirectory']");
    expect(main).toContain('copyPreparedFilesToDirectory(prepared.files, destinationDirectory)');
    expect(main).toContain('assertOriginalAccessStillCurrent');
    expect(preload).toMatch(/ipcRenderer\.invoke\(\s*'desktop:download-original-files'/u);
    expect(preload).toContain('parseAssetDragInput(assetIds)');
    expect(preload).not.toContain('destinationDirectory');
  });
});
