import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

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
    expect(html).toContain('name="allowInsecurePublicHttp"');
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

  it('shows a focused recovery screen and keeps detailed settings collapsed', async () => {
    const html = await readFile(
      new URL('../src/connection-page/index.html', import.meta.url),
      'utf8',
    );
    const css = await readFile(
      new URL('../src/connection-page/connection.css', import.meta.url),
      'utf8',
    );
    expect(html).toContain('id="offline-view"');
    expect(html).toContain('id="online-view"');
    expect(html).toContain('id="retry"');
    expect(html).toContain('id="show-connection-settings"');
    expect(html).toContain('<details id="connection-details"');
    expect(html).toContain('class="cache-summary"');
    expect(html).toContain('src="/seker-eagle-logo.svg"');
    expect(css).toContain('.status-panel');
    expect(css).toContain('.settings-group');
    expect(html).not.toContain('class="sidebar"');
  });

  it('tests, saves, resets deployment binding and returns to the active library through preload only', async () => {
    const script = await readFile(
      new URL('../src/connection-page/connection.js', import.meta.url),
      'utf8',
    );
    for (const method of [
      'getConnectionManagerState',
      'testConnections',
      'retryConnections',
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
      /const settings = formValue\(\);[\s\S]*run\(async \(\) => renderProbes\(await bridge\.testConnections\(settings\)\)\)/u,
    );
  });

  it('retries unavailable connections and keeps advanced controls out of the first view', async () => {
    const script = await readFile(
      new URL('../src/connection-page/connection.js', import.meta.url),
      'utf8',
    );
    expect(script).toContain('window.setInterval');
    expect(script).toContain('bridge.retryConnections()');
    expect(script).toContain('connectionDetails.open = true');
    expect(script).toContain(
      "document.querySelector('#offline-view').hidden = Boolean(state.active)",
    );
  });

  it('localizes the isolated settings page from its locale query without inline scripts', async () => {
    const html = await readFile(
      new URL('../src/connection-page/index.html', import.meta.url),
      'utf8',
    );
    const script = await readFile(
      new URL('../src/connection-page/connection.js', import.meta.url),
      'utf8',
    );
    expect(html).toContain('data-i18n="pageTitle"');
    expect(script).toContain("new window.URLSearchParams(window.location.search).get('lang')");
    expect(script).toContain("'en-US'");
    expect(script).toContain('Desktop Settings');
    expect(script).toContain('document.documentElement.lang = locale');

    const englishCatalog = /'en-US': \{(?<catalog>[\s\S]*?)\r?\n\s{2}\},\r?\n\};/u.exec(script)
      ?.groups?.catalog;
    expect(englishCatalog).toBeTruthy();
    expect(englishCatalog).not.toMatch(/\p{Script=Han}/u);
    for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/gu)) {
      expect(englishCatalog).toContain(`${key}:`);
    }
  });

  it('shows the offline message and returns to the connected state after retry succeeds', async () => {
    const [html, script] = await Promise.all([
      readFile(new URL('../src/connection-page/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/connection-page/connection.js', import.meta.url), 'utf8'),
    ]);
    const dom = new JSDOM(html, {
      url: 'https://connection.invalid/?lang=zh-CN',
      runScripts: 'outside-only',
    });
    const settings = {
      mode: 'AUTO',
      localUrl: 'http://localhost:8180',
      lanUrl: '',
      publicUrl: '',
      allowInsecureLan: false,
      allowInsecurePublicHttp: false,
      deploymentId: null,
    };
    const offline = { settings, active: null, probes: [] };
    const online = {
      settings,
      active: { slot: 'LOCAL', url: 'http://localhost:8180', latencyMs: 5 },
      probes: [],
    };
    const retryConnections = vi.fn().mockResolvedValue(online);
    const testConnections = vi.fn().mockResolvedValue(online);
    Object.defineProperty(dom.window, 'sekerDesktop', {
      value: {
        getConnectionManagerState: () => Promise.resolve(offline),
        getCacheManagerStatus: () =>
          Promise.resolve({
            globalAllocatedBytes: 0,
            limitBytes: 1024 ** 3,
            currentAccountStats: null,
            globalEntryCount: 0,
            availableBytes: 1024 ** 3,
            cachePath: '/tmp/cache',
          }),
        retryConnections,
        testConnections,
      },
    });
    try {
      dom.window.eval(script);
      await vi.waitFor(() => {
        expect(dom.window.document.querySelector('#offline-view')?.hasAttribute('hidden')).toBe(
          false,
        );
        expect(
          (dom.window.document.querySelector('#retry') as { disabled: boolean } | null)?.disabled,
        ).toBe(false);
      });
      (dom.window.document.querySelector('#test') as { click(): void } | null)?.click();
      await vi.waitFor(() => {
        expect(testConnections).toHaveBeenCalledOnce();
        expect(dom.window.document.querySelector('#message')?.textContent).toBe('');
        expect(dom.window.document.querySelector('#offline-view')?.hasAttribute('hidden')).toBe(
          false,
        );
      });
      (dom.window.document.querySelector('#retry') as { click(): void } | null)?.click();
      await vi.waitFor(() => {
        expect(retryConnections).toHaveBeenCalledOnce();
        expect(dom.window.document.querySelector('#online-view')?.hasAttribute('hidden')).toBe(
          false,
        );
      });
    } finally {
      dom.window.close();
    }
  });
});
