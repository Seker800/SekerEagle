import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fleet, validateEnrollment } from './fleet.mjs';
const contract = {
  capacity: { inFlight: 0 },
  model: 'Qwen/Qwen3-VL-Embedding-2B',
  revision: 'fixed',
  dimensions: 1024,
};
const node = (id, extra = {}) => ({
  id,
  name: id,
  url: id === 'mac' ? 'http://127.0.0.1:11435' : 'http://127.0.0.1:11436',
  hostId: 'test-host',
  hostMaxConcurrent: 8,
  token: 'local-test-token',
  accelerator: 'metal',
  operations: ['embedding'],
  maxConcurrent: 3,
  reserveInteractive: 1,
  enabled: true,
  verified: true,
  ...extra,
});
async function fixture(t, nodes = [node('mac')]) {
  const directory = await mkdtemp(join(tmpdir(), 'eagle-fleet-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fleet = new Fleet({ directory, contract, now: () => 100000 });
  await fleet.initialize(nodes);
  return { fleet, directory };
}
test('enrollment rejects untrusted targets and invalid capacity', () => {
  for (const url of [
    'http://192.168.31.89:11435',
    'http://example.com:11435',
    'http://127.0.0.1:11435/secret',
    'http://user:pass@127.0.0.1:11435',
    'http://169.254.169.254:80',
  ])
    assert.throws(() => validateEnrollment(node('bad', { url })));
  assert.throws(() => validateEnrollment(node('bad', { maxConcurrent: 0 })));
  assert.throws(() => validateEnrollment(node('bad', { operations: ['shell'] })));
});

test('artifact capabilities require the actual streaming contract before becoming ready', async (t) => {
  const { fleet } = await fixture(t, [
    node('mac', { accelerator: 'cpu', operations: ['pyramid', 'video'] }),
  ]);
  const health = {
    status: 'ready',
    protocol: 'sekereagle-media-v1',
    operations: ['pyramid', 'video'],
    capacity: { limit: 3, inFlight: 0 },
  };
  fleet.markHealth('mac', health);
  assert.equal(fleet.snapshot().nodes[0].health, 'DRIFTED');
  assert.equal(fleet.acquire('pyramid', false), null);
  fleet.markHealth('mac', { ...health, artifactEncoding: 'SEA1' });
  assert.equal(fleet.snapshot().nodes[0].health, 'READY');
  const slot = fleet.acquire('pyramid', false);
  assert.ok(slot);
  slot.release(10);
});
test('policy persists, uses CAS, expires and never reveals credentials', async (t) => {
  const { fleet, directory } = await fixture(t);
  let s = fleet.snapshot();
  assert.equal(s.revision, 0);
  assert.ok(!JSON.stringify(s).includes('local-test-token'));
  assert.ok(!JSON.stringify(s).includes('127.0.0.1'));
  await fleet.update({
    expectedRevision: 0,
    nodeId: 'mac',
    enabled: false,
    concurrency: 1,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'use Mac',
  });
  await assert.rejects(
    fleet.update({
      expectedRevision: 0,
      nodeId: 'mac',
      enabled: true,
      verified: true,
      concurrency: 2,
      operations: ['embedding'],
      durationSeconds: 60,
      reason: 'stale',
    }),
    /REVISION/,
  );
  const restored = new Fleet({ directory, contract, now: () => 100001 });
  await restored.initialize();
  assert.equal(restored.snapshot().nodes[0].enabled, false);
  const expired = new Fleet({ directory, contract, now: () => 161000 });
  await expired.initialize();
  assert.equal(expired.snapshot().nodes[0].enabled, true);
  assert.equal((await readFile(join(directory, 'state.json'), 'utf8')).includes('use Mac'), true);
  await assert.rejects(
    restored.update({
      expectedRevision: 1,
      nodeId: 'other',
      enabled: true,
      verified: true,
      concurrency: 1,
      operations: ['embedding'],
      durationSeconds: 60,
      reason: 'x',
    }),
    /NOT_FOUND/,
  );
  await assert.rejects(
    restored.update({
      expectedRevision: 1,
      nodeId: 'mac',
      enabled: true,
      verified: true,
      concurrency: 4,
      operations: ['embedding'],
      durationSeconds: 60,
      reason: 'x',
    }),
    /CAPACITY/,
  );
});
test('concurrent policy updates cannot both win', async (t) => {
  const { fleet } = await fixture(t);
  const p = {
    expectedRevision: 0,
    nodeId: 'mac',
    enabled: true,
    verified: true,
    concurrency: 2,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'race',
  };
  const results = await Promise.allSettled([fleet.update(p), fleet.update(p)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
test('routing reserves search capacity, drains and releases only after actual work', async (t) => {
  const { fleet } = await fixture(t);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true });
  const a = fleet.acquire('embedding', false),
    b = fleet.acquire('embedding', false);
  assert.ok(a && b);
  assert.equal(fleet.acquire('embedding', false), null);
  const search = fleet.acquire('embedding', true);
  assert.ok(search);
  assert.equal(fleet.acquire('embedding', true), null);
  await fleet.update({
    expectedRevision: 0,
    nodeId: 'mac',
    enabled: false,
    concurrency: 1,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'drain',
  });
  assert.equal(fleet.acquire('embedding', true), null);
  assert.equal(fleet.snapshot().nodes[0].inFlight, 3);
  a.release(10);
  b.release(10);
  search.release(10);
  assert.equal(fleet.snapshot().nodes[0].inFlight, 0);
  assert.throws(() => a.release(10), /RELEASED/);
});
test('bad model contracts fail closed; offline node does not block another', async (t) => {
  const { fleet } = await fixture(t, [
    node('mac'),
    node('cuda', { accelerator: 'cuda', reserveInteractive: 0 }),
  ]);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true, revision: 'wrong' });
  fleet.markHealth('cuda', { ...contract, status: 'ready', accelerator: 'cuda' });
  assert.equal(fleet.acquire('embedding', false).node.id, 'cuda');
  fleet.markHealth('cuda', null);
  assert.equal(fleet.acquire('embedding', false), null);
});
test('media capabilities are explicit and share the host hard limit', async (t) => {
  const { fleet } = await fixture(t, [
    node('cpu', {
      operations: ['image', 'faces'],
      faceVersion: 'yunet-2023mar-sface-2021dec-v1',
      reserveInteractive: 0,
      maxConcurrent: 1,
    }),
  ]);
  fleet.markHealth('cpu', {
    status: 'ready',
    capacity: { inFlight: 0 },
    protocol: 'sekereagle-media-v1',
    imageEncoding: 'SEI1',
    operations: ['image', 'faces'],
    faceVersion: 'yunet-2023mar-sface-2021dec-v1',
  });
  assert.equal(fleet.acquire('embedding', false), null);
  const a = fleet.acquire('image', false);
  assert.ok(a);
  assert.equal(fleet.acquire('faces', false), null);
  a.release(1);
});

test('enrollment is live, versioned and requires an existing node to drain', async (t) => {
  const { fleet } = await fixture(t);
  await assert.rejects(fleet.enroll({ expectedRevision: 0, node: node('mac') }), /DRAIN/);
  await fleet.enroll({
    expectedRevision: 0,
    node: node('windows', { accelerator: 'cuda', enabled: false }),
  });
  assert.equal(fleet.snapshot().nodes.length, 2);
  await assert.rejects(fleet.enroll({ expectedRevision: 0, node: node('other') }), /REVISION/);
  await fleet.update({
    expectedRevision: 1,
    nodeId: 'mac',
    enabled: false,
    concurrency: 1,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'maintenance',
  });
  await fleet.enroll({ expectedRevision: 2, node: node('mac', { enabled: false }) });
  assert.equal(fleet.snapshot().revision, 3);
});
test('uncertain upstream completion stays quarantined until the host proves idle', async (t) => {
  const { fleet } = await fixture(t);
  fleet.quarantine('mac');
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true, capacity: { inFlight: 1 } });
  assert.equal(fleet.acquire('embedding', true), null);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true, capacity: { inFlight: 0 } });
  assert.ok(fleet.acquire('embedding', true));
});
test('invalid and oversized policies do not mutate persisted state', async (t) => {
  const { fleet } = await fixture(t);
  const p = {
    expectedRevision: 0,
    nodeId: 'mac',
    enabled: true,
    verified: true,
    concurrency: 1,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'test',
  };
  for (const change of [
    { operations: ['faces'] },
    { operations: [] },
    { durationSeconds: 0 },
    { durationSeconds: 604801 },
    { reason: '' },
    { reason: 'x'.repeat(201) },
    { enabled: 'yes' },
  ])
    await assert.rejects(fleet.update({ ...p, ...change }));
  assert.equal(fleet.snapshot().revision, 0);
});

test('invalid persisted policies cannot bypass enrolled capacity after restart', async (t) => {
  const { fleet, directory } = await fixture(t);
  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  state.policies.mac = {
    enabled: true,
    verified: true,
    concurrency: 999,
    operations: ['embedding'],
    expiresAt: 200000,
    reason: 'corrupt',
  };
  await writeFile(join(directory, 'state.json'), JSON.stringify(state));
  const restarted = new Fleet({ directory, contract, now: () => 100000 });
  await assert.rejects(restarted.initialize(), /INVALID_STATE/);
  assert.equal(fleet.snapshot().revision, 0);
});

test('initial validation never persists duplicate IDs or endpoints', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'eagle-init-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fleet = new Fleet({ directory, contract });
  await assert.rejects(fleet.initialize([node('mac'), node('mac')]), /DUPLICATE/);
  await assert.rejects(readFile(join(directory, 'state.json')), /ENOENT/);
  await fleet.initialize([node('mac')]);
  await assert.rejects(
    fleet.enroll({ expectedRevision: 0, node: node('other', { url: 'http://127.0.0.1:11435' }) }),
    /DUPLICATE/,
  );
});
test('restart waits for actual prior compute and rejects an undersized backend', async (t) => {
  const { fleet } = await fixture(t);
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 1, limit: 3 },
  });
  assert.equal(fleet.acquire('embedding', true), null);
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 0, limit: 1 },
  });
  assert.equal(fleet.snapshot().nodes[0].health, 'DRIFTED');
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 0, limit: 3 },
  });
  assert.ok(fleet.acquire('embedding', true));
});
test('separate endpoints on one physical host share a hard cap and search reserve', async (t) => {
  const { fleet } = await fixture(t, [
    node('mac', { hostId: 'box', hostMaxConcurrent: 3, maxConcurrent: 2 }),
    node('media', {
      hostId: 'box',
      hostMaxConcurrent: 3,
      maxConcurrent: 2,
      reserveInteractive: 0,
      accelerator: 'cpu',
      operations: ['image'],
    }),
  ]);
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 0, limit: 2 },
  });
  fleet.markHealth('media', {
    status: 'ready',
    protocol: 'sekereagle-media-v1',
    imageEncoding: 'SEI1',
    operations: ['image'],
    capacity: { inFlight: 0, limit: 2 },
  });
  const a = fleet.acquire('embedding', false),
    b = fleet.acquire('image', false);
  assert.ok(a && b);
  assert.equal(fleet.acquire('image', false), null);
  assert.ok(fleet.acquire('embedding', true));
  assert.equal(fleet.acquire('image', true), null);
});

test('host metrics are numeric diagnostics and unknown fields never escape', async (t) => {
  const { fleet } = await fixture(t);
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    memory: { activeBytes: 42, cacheBytes: 100, secret: 'not-returned' },
    system: { freeMemoryBytes: 1000, token: 'not-returned' },
  });
  const state = fleet.snapshot();
  assert.equal(state.nodes[0].memory.activeBytes, 42);
  assert.ok(!JSON.stringify(state).includes('not-returned'));
});

test('advertised background capacity is capped by the physical host, not endpoint sum', async (t) => {
  const { fleet } = await fixture(t, [
    node('mac', { hostMaxConcurrent: 3 }),
    node('cuda', { hostMaxConcurrent: 3, accelerator: 'cuda' }),
  ]);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true });
  fleet.markHealth('cuda', { ...contract, status: 'ready', accelerator: 'cuda' });
  assert.equal(fleet.snapshot().backgroundLimit, 2);
});

test('an unverified backend cannot be enabled by an agent policy', async (t) => {
  const { fleet } = await fixture(t, [node('mac', { verified: false, enabled: false })]);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true });
  await assert.rejects(
    fleet.update({
      expectedRevision: 0,
      nodeId: 'mac',
      enabled: true,
      concurrency: 1,
      operations: ['embedding'],
      durationSeconds: 60,
      reason: 'enable',
    }),
    /UNVERIFIED/,
  );
  assert.equal(fleet.acquire('embedding', true), null);
});

test('failed probes never release the startup idle barrier and external work consumes node slots', async (t) => {
  const { fleet } = await fixture(t, [node('mac', { maxConcurrent: 1, reserveInteractive: 0 })]);
  fleet.markHealth('mac', null);
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 1, limit: 1 },
  });
  assert.equal(fleet.acquire('embedding', true), null);
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 0, limit: 1 },
  });
  fleet.markHealth('mac', {
    ...contract,
    status: 'ready',
    metal: true,
    capacity: { inFlight: 1, limit: 1 },
  });
  assert.equal(fleet.acquire('embedding', true), null);
});

const mediaNode = (id, operations = ['image', 'video']) =>
  node(id, {
    accelerator: 'cpu',
    operations,
    maxConcurrent: 4,
    reserveInteractive: 0,
  });
const mediaHealth = (inFlight = 0) => ({
  status: 'ready',
  protocol: 'sekereagle-media-v1',
  imageEncoding: 'SEI1',
  artifactEncoding: 'SEA1',
  operations: ['image', 'video'],
  capacity: { limit: 4, inFlight },
});

test('an idle media host takes work instead of queueing behind a busy host with a cheaper unrelated history', async (t) => {
  const { fleet } = await fixture(t, [mediaNode('mac', ['image']), mediaNode('windows')]);
  for (const id of ['mac', 'windows']) fleet.markHealth(id, mediaHealth());
  const longVideo = fleet.acquire('video', false);
  assert.equal(longVideo.node.id, 'windows');
  longVideo.release(300000);
  const image = fleet.acquire('image', false);
  assert.equal(image.node.id, 'mac');
  const next = fleet.acquire('image', false);
  assert.equal(next.node.id, 'windows');
  image.release(20);
  next.release(20);
});

test('busy hosts compare the same operation rather than video time against image time', async (t) => {
  const { fleet } = await fixture(t, [mediaNode('windows')]);
  fleet.markHealth('windows', mediaHealth());
  fleet.acquire('video', false).release(300000);
  fleet.acquire('image', false).release(20);
  await fleet.enroll({ expectedRevision: 0, node: mediaNode('mac', ['image']) });
  fleet.markHealth('mac', mediaHealth());
  const warm = fleet.acquire('image', false);
  assert.equal(warm.node.id, 'mac');
  warm.release(200);
  for (const id of ['mac', 'windows']) fleet.markHealth(id, mediaHealth(1));
  const next = fleet.acquire('image', false);
  assert.equal(next.node.id, 'windows');
  next.release(20);
  const windows = fleet.snapshot().nodes.find((n) => n.id === 'windows');
  assert.equal(windows.operationAverageMs.image, 20);
  assert.equal(windows.operationAverageMs.video, 300000);
});

test('quickly completed requests do not starve another verified idle host', async (t) => {
  const { fleet } = await fixture(t, [mediaNode('mac'), mediaNode('windows')]);
  for (const id of ['mac', 'windows']) fleet.markHealth(id, mediaHealth());
  const counts = { mac: 0, windows: 0 };
  for (let i = 0; i < 12; i++) {
    const slot = fleet.acquire('image', false);
    counts[slot.node.id]++;
    slot.release(slot.node.id === 'mac' ? 1 : 50);
  }
  assert.deepEqual(counts, { mac: 6, windows: 6 });
});

test('interactive retrieval keeps latency preference rather than idle background rotation', async (t) => {
  const { fleet } = await fixture(t, [node('mac'), node('cuda', { accelerator: 'cuda' })]);
  fleet.markHealth('mac', { ...contract, status: 'ready', metal: true });
  fleet.markHealth('cuda', { ...contract, status: 'ready', accelerator: 'cuda' });
  const policy = {
    nodeId: 'cuda',
    concurrency: 3,
    operations: ['embedding'],
    durationSeconds: 60,
    reason: 'Synthetic latency warmup',
  };
  await fleet.update({ ...policy, expectedRevision: 0, enabled: false });
  for (let i = 0; i < 10; i++) fleet.acquire('embedding', true).release(10);
  await fleet.update({ ...policy, expectedRevision: 1, enabled: true });
  const first = fleet.acquire('embedding', true);
  assert.equal(first.node.id, 'mac');
  const second = fleet.acquire('embedding', true);
  assert.equal(second.node.id, 'mac');
  first.release(10);
  second.release(10);
});
