import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fleet, validateEnrollment } from './fleet.mjs';
const contract = { model: 'Qwen/Qwen3-VL-Embedding-2B', revision: 'fixed', dimensions: 1024 };
const node = (id, extra = {}) => ({
  id,
  name: id,
  url: id==='mac'?'http://127.0.0.1:11435':'http://127.0.0.1:11436',
  hostId:'test-host',hostMaxConcurrent:8,
  token: 'local-test-token',
  accelerator: 'metal',
  operations: ['embedding'],
  maxConcurrent: 3,
  reserveInteractive: 1,
  enabled: true,
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
    node('cpu', { operations: ['image', 'faces'], reserveInteractive: 0, maxConcurrent: 1 }),
  ]);
  fleet.markHealth('cpu', {
    status: 'ready',
    protocol: 'sekereagle-media-v1',
    operations: ['image', 'faces'],
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

test('initial validation never persists duplicate IDs or endpoints',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'eagle-init-'));t.after(()=>rm(directory,{recursive:true,force:true}));const fleet=new Fleet({directory,contract});
 await assert.rejects(fleet.initialize([node('mac'),node('mac')]),/DUPLICATE/);
 await assert.rejects(readFile(join(directory,'state.json')),/ENOENT/);
 await fleet.initialize([node('mac')]);
 await assert.rejects(fleet.enroll({expectedRevision:0,node:node('other',{url:'http://127.0.0.1:11435'})}),/DUPLICATE/);
});
test('restart waits for actual prior compute and rejects an undersized backend',async t=>{
 const {fleet}=await fixture(t);fleet.markHealth('mac',{...contract,status:'ready',metal:true,capacity:{inFlight:1,limit:3}});assert.equal(fleet.acquire('embedding',true),null);
 fleet.markHealth('mac',{...contract,status:'ready',metal:true,capacity:{inFlight:0,limit:1}});assert.equal(fleet.snapshot().nodes[0].health,'DRIFTED');
 fleet.markHealth('mac',{...contract,status:'ready',metal:true,capacity:{inFlight:0,limit:3}});assert.ok(fleet.acquire('embedding',true));
});
test('separate endpoints on one physical host share a hard cap and search reserve',async t=>{
 const {fleet}=await fixture(t,[node('mac',{hostId:'box',hostMaxConcurrent:3,maxConcurrent:2}),node('media',{hostId:'box',hostMaxConcurrent:3,maxConcurrent:2,reserveInteractive:0,accelerator:'cpu',operations:['image']})]);
 fleet.markHealth('mac',{...contract,status:'ready',metal:true,capacity:{inFlight:0,limit:2}});fleet.markHealth('media',{status:'ready',protocol:'sekereagle-media-v1',operations:['image'],capacity:{inFlight:0,limit:2}});
 const a=fleet.acquire('embedding',false),b=fleet.acquire('image',false);assert.ok(a&&b);assert.equal(fleet.acquire('image',false),null);assert.ok(fleet.acquire('embedding',true));assert.equal(fleet.acquire('image',true),null);
});
