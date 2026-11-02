import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createAssetOperationExecutors } from '../../apps/api/dist/asset-operation-executor.js';
import { lockOwnerPrivacyProjection } from '../../packages/library-persistence/dist/privacy-lock.js';
import { observePrismaAdapter } from './database-query-probe.mjs';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const queries = [];
const evidence = [];
const db = new PrismaClient({ adapter: observePrismaAdapter((event) => queries.push(event)) });
const owners = [];
let storageCalls = 0;
const storage = new Proxy(
  {},
  {
    get: () => () => {
      storageCalls++;
      throw new Error('metadata command touched object storage');
    },
  },
);
const executors = createAssetOperationExecutors(db, storage);
after(async () => {
  for (const ownerId of owners) {
    await db.eagleAssetOperation.deleteMany({ where: { ownerId } });
    await db.eaglePhotoGroup.deleteMany({ where: { ownerId } });
    await db.eagleAssetManualTag.deleteMany({ where: { ownerId } });
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.eagleManualTag.deleteMany({ where: { ownerId } });
    await db.user.delete({ where: { id: ownerId } });
  }
  await db.$disconnect();
  mkdirSync('.omx/artifacts', { recursive: true });
  writeFileSync(
    '.omx/artifacts/library-command-costs.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
});
async function fixture(mode = 'MATERIAL') {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  const service = executors[mode === 'PHOTO' ? 1 : 0];
  const principal = {
    sub: ownerId,
    role: 'USER',
    email: 'synthetic@example.invalid',
    kind: 'browser',
    authVersion: 0,
    scopes: [],
    canViewPrivate: false,
    privacyVisibleUntil: null,
  };
  const add = (changes = {}) => {
    const id = randomUUID();
    return db.eagleAsset.create({
      data: {
        id,
        ownerId,
        libraryMode: mode,
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        originalObjectKey: `users/${ownerId}/${id}.jpg`,
        lifecycleStatus: 'READY',
        mediaRevision: 1,
        ...changes,
      },
    });
  };
  const tag = () =>
    db.eagleManualTag.create({
      data: {
        id: randomUUID(),
        ownerId,
        libraryMode: mode,
        name: randomUUID(),
        normalizedName: randomUUID(),
      },
    });
  const enqueue = (rows, tags, extra = {}) =>
    service.enqueueCommand(principal, {
      type: 'ASSET_TAGS',
      assetIds: rows.map((a) => a.id),
      payload: { addTagIds: tags.map((t) => t.id), removeTagIds: [], clearAll: false },
      ...extra,
    });
  const state = async (id) => (await service.list(ownerId, true)).find((row) => row.id === id);
  const drain = async (id) => {
    for (let i = 0; i < 1000; i++) {
      const current = await state(id);
      if (!['QUEUED', 'RUNNING'].includes(current.state)) return current;
      await service.tick(false);
    }
    assert.fail('command did not terminate');
  };
  return { ownerId, mode, service, principal, add, tag, enqueue, state, drain };
}

for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode} accepts while publication lock is held, then applies relative tags to current metadata`, async () => {
    const f = await fixture(mode);
    const asset = await f.add();
    const tag = await f.tag();
    let release;
    let locked;
    const ready = new Promise((resolve) => {
      locked = resolve;
    });
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, f.ownerId, mode);
        locked();
        await hold;
      },
      { timeout: 10000 },
    );
    await ready;
    let op;
    try {
      // The lock cannot release until admission finishes; the DB statement timeout makes a regression fail.
      op = await f.enqueue([asset], [tag]);
      assert.equal(op.state, 'QUEUED');
      assert.equal(await db.eagleAssetManualTag.count({ where: { assetId: asset.id } }), 0);
      await db.eagleAsset.update({
        where: { id: asset.id },
        data: { rowVersion: { increment: 1 }, displayName: 'concurrent metadata' },
      });
    } finally {
      release();
      await blocker;
    }
    const result = await f.drain(op.id);
    assert.equal(result.state, 'COMPLETED');
    assert.equal(
      await db.eagleAssetManualTag.count({ where: { assetId: asset.id, tagId: tag.id } }),
      1,
    );
    assert.equal(
      (await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).displayName,
      'concurrent metadata',
    );
    assert.equal(storageCalls, 0);
  });

test('command identity, cancellation, retry and owner/privacy/version boundaries persist', async () => {
  const f = await fixture();
  const other = await fixture();
  const asset = await f.add();
  const secret = await f.add({ isPrivate: true });
  const foreign = await other.add();
  const tag = await f.tag();
  for (const target of [secret, foreign])
    await assert.rejects(f.enqueue([target], [tag]), (error) => error.getStatus?.() === 404);
  const opId = randomUUID();
  const op = await f.enqueue([asset], [tag], { operationId: opId });
  assert.equal((await f.enqueue([asset], [tag], { operationId: opId })).id, op.id);
  await assert.rejects(
    f.enqueue([asset], [], { operationId: opId }),
    (error) => error.getStatus?.() === 409,
  );
  await assert.rejects(
    f.service.cancel(other.principal, op.id),
    (error) => error.getStatus?.() === 404,
  );
  await f.service.cancel(f.principal, op.id);
  await f.service.tick(false);
  assert.equal((await f.state(op.id)).state, 'STOPPED');
  assert.equal(await db.eagleAssetManualTag.count({ where: { assetId: asset.id } }), 0);
  const changed = await f.enqueue([asset], [tag]);
  await db.eagleAsset.update({
    where: { id: asset.id },
    data: { mediaRevision: { increment: 1 } },
  });
  assert.equal((await f.drain(changed.id)).state, 'STOPPED');
  await db.eagleAsset.update({ where: { id: asset.id }, data: { mediaRevision: 1 } });
  await f.service.retry(f.principal, changed.id);
  assert.equal((await f.drain(changed.id)).state, 'COMPLETED');
  const revoked = await f.enqueue([asset], []);
  await db.user.update({ where: { id: f.ownerId }, data: { authVersion: { increment: 1 } } });
  assert.equal((await f.drain(revoked.id)).state, 'STOPPED');
});

test('metadata conflicts isolate stale resources without rejecting healthy batch members', async () => {
  const f = await fixture();
  const rows = await Promise.all([f.add(), f.add(), f.add()]);
  const tag = await f.tag();
  const op = await f.enqueue(rows, [tag]);
  await db.eagleAsset.update({
    where: { id: rows[1].id },
    data: { mediaRevision: { increment: 1 } },
  });
  const result = await f.drain(op.id);
  assert.equal(result.state, 'STOPPED');
  assert.equal(result.total, 3);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 1);
  const linked = await db.eagleAssetManualTag.findMany({
    where: { ownerId: f.ownerId, tagId: tag.id },
    select: { assetId: true },
  });
  assert.deepEqual(linked.map((row) => row.assetId).sort(), [rows[0].id, rows[2].id].sort());
});

test('PHOTO group commands use original atomic publication and owner-scoped admission', async () => {
  const f = await fixture('PHOTO');
  const first = await f.add();
  const second = await f.add();
  const op = await f.service.enqueueCommand(f.principal, {
    type: 'PHOTO_GROUP_CREATE',
    payload: { assetIds: [first.id, second.id] },
  });
  assert.equal((await f.drain(op.id)).state, 'COMPLETED');
  const groups = await db.eaglePhotoGroup.findMany({
    where: { ownerId: f.ownerId },
    include: { members: true },
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 2);
  await assert.rejects(
    f.service.enqueueCommand(f.principal, {
      type: 'PHOTO_GROUP_UPDATE',
      payload: { id: randomUUID(), dismissed: true },
    }),
    (error) => error.getStatus?.() === 404,
  );
});

test('private grants are checked again when queued publication starts', async () => {
  const f = await fixture();
  const asset = await f.add({ isPrivate: true });
  const tag = await f.tag();
  const privatePrincipal = {
    ...f.principal,
    canViewPrivate: true,
    privacyVisibleUntil: new Date(Date.now() + 60000).toISOString(),
  };
  const op = await f.service.enqueueCommand(privatePrincipal, {
    type: 'ASSET_TAGS',
    assetIds: [asset.id],
    payload: { addTagIds: [tag.id], removeTagIds: [] },
  });
  await db.eagleAssetOperation.update({
    where: { id: op.id },
    data: { privateUntil: new Date(0) },
  });
  await f.service.tick(false);
  assert.equal((await f.state(op.id)).state, 'STOPPED');
  assert.equal((await f.state(op.id)).failed, 1);
  assert.equal(await db.eagleAssetManualTag.count({ where: { assetId: asset.id } }), 0);
  await f.service.retry(privatePrincipal, op.id);
  assert.equal((await f.drain(op.id)).state, 'COMPLETED');
});

test('background command stores intent before performing its original guarded transaction', async () => {
  const f = await fixture();
  const asset = await f.add();
  let executions = 0;
  f.service.commands.register('TEST_BACKGROUND_SUCCESS', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      executions++;
      await db.$transaction(async (tx) => {
        await context.beforePublish(tx);
        await tx.eagleAsset.update({
          where: { id: asset.id },
          data: { displayName: 'background result' },
        });
      });
    },
  });
  const op = await f.service.enqueueCommand(f.principal, {
    type: 'TEST_BACKGROUND_SUCCESS',
    payload: {},
  });
  assert.equal(executions, 0);
  assert.equal((await f.drain(op.id)).state, 'COMPLETED');
  assert.equal(executions, 1);
  assert.equal(
    (await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).displayName,
    'background result',
  );
});

test('background intent runs independently and rejects a stolen lease before publication', async () => {
  const f = await fixture();
  const asset = await f.add();
  let opId;
  f.service.commands.register('TEST_BACKGROUND_GUARD', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      await db.eagleAssetOperationItem.updateMany({
        where: { operationId: opId, status: 'RUNNING' },
        data: { leaseVersion: { increment: 1 } },
      });
      await db.$transaction(async (tx) => {
        await context.beforePublish(tx);
        await tx.eagleAsset.update({
          where: { id: asset.id },
          data: { displayName: 'stale publisher' },
        });
      });
    },
  });
  const op = await f.service.enqueueCommand(f.principal, {
    type: 'TEST_BACKGROUND_GUARD',
    payload: {},
  });
  opId = op.id;
  assert.equal(op.state, 'QUEUED');
  await f.service.tick(false);
  assert.notEqual(
    (await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).displayName,
    'stale publisher',
  );
});

for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode} consecutive accepted edits preserve both changes from the same visible row version`, async () => {
    const f = await fixture(mode);
    const asset = await f.add();
    const update = (payload) =>
      f.service.enqueueCommand(f.principal, {
        type: 'ASSET_UPDATE',
        assetIds: [asset.id],
        payload: { assets: [{ assetId: asset.id, rowVersion: asset.rowVersion }], ...payload },
      });
    const first = await update({ rating: 5 });
    const second = await update({ description: 'queued description' });
    assert.equal((await f.drain(second.id)).state, 'COMPLETED');
    assert.equal((await f.state(first.id)).state, 'COMPLETED');
    const current = await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(current.rating, 5);
    assert.equal(current.rowVersion, asset.rowVersion + 2);
    assert.equal(
      (
        await db.eagleAssetAnnotation.findUniqueOrThrow({
          where: { ownerId_assetId: { ownerId: f.ownerId, assetId: asset.id } },
        })
      ).description,
      'queued description',
    );
  });
  test(`${mode} a completed predecessor permits its exact receipt version and rejects external intervening writes`, async () => {
    const f = await fixture(mode);
    const asset = await f.add();
    const first = await f.service.enqueueCommand(f.principal, {
      type: 'ASSET_UPDATE',
      assetIds: [asset.id],
      payload: { assets: [{ assetId: asset.id, rowVersion: asset.rowVersion }], rating: 4 },
    });
    assert.equal((await f.drain(first.id)).state, 'COMPLETED');
    const input = {
      type: 'ASSET_UPDATE',
      assetIds: [asset.id],
      payload: {
        assets: [{ assetId: asset.id, rowVersion: asset.rowVersion }],
        description: 'after receipt',
        predecessorOperationIds: [first.id],
      },
    };
    const second = await f.service.enqueueCommand(f.principal, input);
    assert.equal((await f.drain(second.id)).state, 'COMPLETED');
    assert.equal((await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).rating, 4);
    assert.equal(
      (
        await db.eagleAssetAnnotation.findUniqueOrThrow({
          where: { ownerId_assetId: { ownerId: f.ownerId, assetId: asset.id } },
        })
      ).description,
      'after receipt',
    );
    await db.eagleAsset.update({
      where: { id: asset.id },
      data: { rowVersion: { increment: 1 }, displayName: 'external edit' },
    });
    await assert.rejects(
      f.service.enqueueCommand(f.principal, input),
      (error) => error.getStatus?.() === 409,
    );
    assert.equal(
      (await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).displayName,
      'external edit',
    );
    assert.equal(
      (
        await db.eagleAssetAnnotation.findUniqueOrThrow({
          where: { ownerId_assetId: { ownerId: f.ownerId, assetId: asset.id } },
        })
      ).description,
      'after receipt',
    );
  });
}

test(
  '60k metadata acceptance stays set-based and a healthy publication quantum has bounded SQL and no S3',
  { timeout: 120000 },
  async () => {
    const f = await fixture();
    const tag = await f.tag();
    const ids = Array.from({ length: 60000 }, () => randomUUID());
    for (let start = 0; start < ids.length; start += 1000)
      await db.eagleAsset.createMany({
        data: ids.slice(start, start + 1000).map((id) => ({
          id,
          ownerId: f.ownerId,
          libraryMode: f.mode,
          originalName: 'synthetic.jpg',
          displayName: 'Synthetic',
          normalizedDisplayName: 'synthetic',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${f.ownerId}/${id}.jpg`,
          lifecycleStatus: 'READY',
          mediaRevision: 1,
        })),
      });
    queries.length = 0;
    const started = performance.now();
    const op = await f.enqueue(
      ids.map((id) => ({ id })),
      [tag],
    );
    const admission = {
      sql: queries.length,
      transactions: queries.filter((event) => event.query === 'BEGIN').length,
      ms: performance.now() - started,
    };
    assert.equal(op.total, 60000);
    assert.equal(admission.transactions, 1);
    assert.ok(admission.sql < 160, `admission SQL ${admission.sql}`);
    queries.length = 0;
    await f.service.tick(false);
    const publication = {
      sql: queries.length,
      transactions: queries.filter((event) => event.query === 'BEGIN').length,
    };
    assert.ok(publication.sql < 1000, `publication SQL ${publication.sql}`);
    assert.equal(storageCalls, 0);
    evidence.push({
      assets: ids.length,
      admission,
      publication,
      s3: storageCalls,
      frontendRefresh:
        'acceptance receipt; terminal reconciliation, verified separately in browser tests',
    });
    await f.service.cancel(f.principal, op.id);
  },
);
