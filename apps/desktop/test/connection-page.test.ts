import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('offline-capable desktop connection page', () => {
  it('ships local, LAN and public inputs without inline executable code', async () => {
    const html = await readFile(
      new URL('../src/connection-page/index.html', import.meta.url),
      'utf8',
    );
    expect(html).toContain('name="localUrl"');
    expect(html).toContain('name="lanUrl"');
    expect(html).toContain('name="publicUrl"');
    expect(html).toContain('name="allowInsecureLan"');
    expect(html).toContain('name="mode"');
    expect(html).toContain('src="/connection.js"');
    expect(html).not.toMatch(/<script(?![^>]+src=)/u);
  });

  it('shows cache capacity, runtime statistics, disk state and maintenance actions', async () => {
    const html = await readFile(
      new URL('../src/connection-page/index.html', import.meta.url),
      'utf8',
    );
    expect(html).toContain('id="cache-settings"');
    expect(html).toContain('name="cacheLimitGiB"');
    expect(html).toContain('id="cache-global-usage"');
    expect(html).toContain('id="cache-account-usage"');
    expect(html).toContain('id="cache-hit-rate"');
    expect(html).toContain('id="cache-saved-bytes"');
    expect(html).toContain('id="cache-free-space"');
    expect(html).toContain('id="cache-path"');
    expect(html).toContain('id="save-cache"');
    expect(html).toContain('id="clear-cache"');
    expect(html).toContain('id="open-cache-folder"');
  });

  it('tests, saves, resets deployment binding and returns to the active library through preload only', async () => {
    const script = await readFile(
      new URL('../src/connection-page/connection.js', import.meta.url),
      'utf8',
    );
    for (const method of [
      'getConnectionManagerState',
      'testConnections',
      'saveConnections',
      'resetDeploymentBinding',
      'cancelConnectionManager',
    ]) {
      expect(script).toContain(`bridge.${method}`);
    }
    for (const method of [
      'getCacheManagerStatus',
      'setCacheLimitGiB',
      'clearCache',
      'openCacheFolder',
    ]) {
      expect(script).toContain(`bridge.${method}`);
    }
    expect(script).not.toContain('innerHTML');
  });

  it('captures form values before disabling controls during an async action', async () => {
    const script = await readFile(
      new URL('../src/connection-page/connection.js', import.meta.url),
      'utf8',
    );
    expect(script).toMatch(
      /const settings = formValue\(\);[\s\S]*run\(async \(\) => render\(await bridge\.saveConnections\(settings\)\)\)/u,
    );
    expect(script).toMatch(
      /const settings = formValue\(\);[\s\S]*run\(async \(\) => render\(await bridge\.testConnections\(settings\)\)\)/u,
    );
  });
});
