import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface DesktopPackage {
  scripts?: Record<string, string>;
  build?: {
    win?: {
      artifactName?: string;
      target?: Array<{ target?: string; arch?: string[] }>;
    };
    portable?: Record<string, unknown>;
  };
}

describe('Windows desktop packaging', () => {
  it('produces a no-install x64 portable executable without elevation', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as DesktopPackage;

    expect(manifest.build?.win).toMatchObject({
      artifactName: '${productName}-${version}-windows-${arch}-portable.${ext}',
      target: [{ target: 'portable', arch: ['x64'] }],
    });
    expect(manifest.build?.portable).toEqual({ requestExecutionLevel: 'user' });
    expect(manifest.scripts?.['package:win']).toContain('electron-builder --win portable --x64');
    expect(manifest.scripts?.['package:win']).not.toContain('nsis');
  });
});
