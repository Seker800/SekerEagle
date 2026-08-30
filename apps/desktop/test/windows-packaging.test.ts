import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface DesktopPackage {
  build?: {
    win?: {
      target?: Array<{ target?: string; arch?: string[] }>;
    };
    nsis?: Record<string, unknown>;
  };
}

describe('Windows desktop packaging', () => {
  it('produces a per-user x64 NSIS installer that preserves user data on uninstall', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as DesktopPackage;

    expect(manifest.build?.win?.target).toContainEqual({ target: 'nsis', arch: ['x64'] });
    expect(manifest.build?.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'SekerEagle',
      uninstallDisplayName: 'SekerEagle',
      deleteAppDataOnUninstall: false,
      runAfterFinish: true,
    });
  });
});
