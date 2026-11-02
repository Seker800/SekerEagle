import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installClientCacheProbe } from './client-cache-probe.mjs';

test('probe records response-header timing without retaining URLs, headers or credentials', async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.com' });
  const originalFetch = async () =>
    new globalThis.Response('image', { headers: { 'x-sekereagle-cache-result': 'REVALIDATED' } });
  dom.window.fetch = originalFetch;
  const probe = installClientCacheProbe(dom.window);
  probe.begin('folder-open');
  const response = await dom.window.fetch(
    '/api/photos/assets/secret-id/renditions/secret-id?token=secret',
  );
  assert.equal(await response.text(), 'image');
  const result = probe.report();
  assert.equal(result.scenarios[0].requests[0].kind, 'photo-image');
  assert.equal(result.scenarios[0].requests[0].cacheResult, 'REVALIDATED');
  assert(!JSON.stringify(result).includes('secret'));
  probe.stop();
  assert.equal(dom.window.fetch, originalFetch);
  dom.window.close();
});

test('probe separates scenarios, ignores unrelated traffic, and preserves network errors', async () => {
  const dom = new JSDOM('', { url: 'https://example.com' });
  dom.window.fetch = async (url) => {
    if (url.includes('fail')) throw new Error('private error');
    return new globalThis.Response('ok');
  };
  const probe = installClientCacheProbe(dom.window);
  probe.begin('folder-open');
  await dom.window.fetch('/api/photos/assets?limit=120');
  await dom.window.fetch('https://unrelated.invalid/path');
  probe.begin('folder-return');
  await assert.rejects(dom.window.fetch('/api/eagle/assets?fail=1'), /private error/);
  const report = probe.report();
  assert.equal(report.scenarios[0].requests.length, 1);
  assert.equal(report.scenarios[1].requests[0].status, 0);
  assert.equal(report.scenarios[1].requests[0].kind, 'material-list');
  assert(!JSON.stringify(report).includes('private error'));
  assert.throws(() => probe.begin('an arbitrary photo name'));
  probe.stop();
  dom.window.close();
});
