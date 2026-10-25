import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const policy = () => import('./android-lab-policy.mjs');
test('restarting the lab retains credentials and rejects a foreign deployment', async () => {
  const { ensureLabConfig, assertLabConfig } = await policy();
  const dir = await mkdtemp(join(tmpdir(), 'eagle-lab-'));
  try {
    const first = await ensureLabConfig(dir);
    const second = await ensureLabConfig(dir);
    assert.deepEqual(second, first);
    assert.equal(first.origin, 'http://localhost:49813');
    assert.equal((await stat(join(dir, 'config.json'))).mode & 0o777, 0o600);
    assert.ok((await readFile(join(dir, 'config.json'), 'utf8')).includes(first.password));
    for (const changes of [{ origin: 'https://yuntai.design:8181' }, { databasePort: 5432 }, { kind: 'production' }])
      assert.throws(() => assertLabConfig({ ...first, ...changes }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('durable containers have owned volumes, restart policy and loopback bindings', async () => {
  const { ensureLabConfig, containerSpec, assertOwnedContainer } = await policy();
  const dir = await mkdtemp(join(tmpdir(), 'eagle-lab-'));
  try {
    const config = await ensureLabConfig(dir);
    for (const role of ['db', 'storage']) {
      const spec = containerSpec(config, role);
      assert.ok(spec.args.includes('--volume'));
      assert.ok(spec.args.includes('unless-stopped'));
      assert.ok(!spec.args.includes('--rm') && !spec.args.includes('--tmpfs'));
      assert.ok(spec.args.some(arg => arg.startsWith('127.0.0.1:')));
      const info = { Config: { Labels: { 'com.sekereagle.lab': config.id, 'com.sekereagle.lab.role': role }, Image: spec.image }, Mounts: [{ Name: spec.volume, Destination: spec.destination }], HostConfig: { PortBindings: { [spec.containerPort]: [{ HostIp: '127.0.0.1', HostPort: String(spec.port) }] } } };
      assert.doesNotThrow(() => assertOwnedContainer(config, role, info));
      assert.throws(() => assertOwnedContainer(config, role, { ...info, Config: { ...info.Config, Labels: {} } }));
      assert.throws(() => assertOwnedContainer(config, role, { ...info, Mounts: [] }));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('fixed real-photo recipes cover both libraries and useful positive filter combinations', async () => {
  const { fixturePlan } = await policy();
  const plan = fixturePlan(27);
  assert.deepEqual(plan, fixturePlan(27));
  assert.equal(new Set(plan.map(row => row.key)).size, plan.length);
  for (const mode of ['PHOTO', 'MATERIAL']) {
    const rows = plan.filter(row => row.mode === mode);
    assert.ok(rows.length >= 72);
    assert.deepEqual([...new Set(rows.map(row => row.rating))].sort(), [0,1,2,3,4,5]);
    assert.deepEqual([...new Set(rows.map(row => row.format))].sort(), ['jpeg','png','webp']);
    assert.equal(new Set(rows.map(row => row.camera)).size, 3);
    assert.ok(rows.some(row => row.gps) && rows.some(row => !row.gps));
    assert.ok(rows.some(row => row.theme === '旅行' && row.camera === 'Canon EOS R5' && row.rating >= 4 && row.gps && row.format === 'jpeg'));
  }
});
