import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { control } from './control.mjs';
import { readSecret } from './main.mjs';
import { readPrivateJson } from './fleet.mjs';
test('CLI uses an owner-only credential and loopback, returns only server data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'eagle-control-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const token = join(dir, 'token');
  await writeFile(token, 'private-test-token', { mode: 0o600 });
  const config = { baseUrl: 'http://127.0.0.1:11436', adminTokenFile: token };
  let request;
  const result = await control('status', undefined, config, async (url, options) => {
    request = { url, options };
    return globalThis.Response.json({ revision: 1, nodes: [] });
  });
  assert.equal(result.revision, 1);
  assert.equal(request.options.headers.authorization, 'Bearer private-test-token');
  assert.ok(request.url.endsWith('/admin/fleet'));
  await control('policy', { expectedRevision: 1 }, config, async (url, options) => {
    assert.equal(options.method, 'POST');
    return globalThis.Response.json({ revision: 2 });
  });
  await assert.rejects(control('enroll', {}, config), /Use status/);
  await assert.rejects(
    control('status', undefined, { ...config, baseUrl: 'http://10.0.0.1:11436' }),
    /LOOPBACK/,
  );
  await assert.rejects(
    control('status', undefined, config, async () => new globalThis.Response('', { status: 409 })),
    /409/,
  );
  await chmod(token, 0o644);
  await assert.rejects(readSecret(token), /PRIVATE/);
  await chmod(token, 0o600);
  const alias = join(dir, 'alias');
  await symlink(token, alias);
  await assert.rejects(readSecret(alias));
  const json = join(dir, 'state');
  await writeFile(json, '{}', { mode: 0o600 });
  assert.deepEqual(await readPrivateJson(json), {});
  await chmod(json, 0o644);
  await assert.rejects(readPrivateJson(json), /PRIVATE/);
});
