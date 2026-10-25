import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { EagleLibraryTransferService } from '../../apps/api/dist/eagle/eagle-library-transfer.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
const owners = [];
afterEach(async () => {
  await prisma.eagleAssetOperation.deleteMany({ where: { ownerId: { in: owners.splice(0) } } });
});
after(() => prisma.$disconnect());
function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
async function fixture(mode = 'PHOTO', copy) {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await prisma.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
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
  let copies = 0;
  const storage = {
    copyObject: async (...args) => {
      copies++;
      await copy?.(...args);
    },
    headObject: async () => ({ ContentLength: 1 }),
  };
  const createService = (db = prisma) =>
    new EagleAssetOperationService(
      db,
      new EagleLibraryTransferService(prisma, storage, mode),
      new EagleService(prisma, undefined, mode),
      mode,
    );
  const add = async (changes = {}) => {
    const id = randomUUID();
    return prisma.eagleAsset.create({
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
        originalObjectKey: `users/${ownerId}/assets/${id}/original.jpg`,
        lifecycleStatus: 'READY',
        mediaRevision: 1,
        ...changes,
      },
    });
  };
  const service = createService();
  const enqueue = (kind, rows, operationId = randomUUID()) =>
    service.enqueue(principal, { kind, operationId, assetIds: rows.map((row) => row.id) });
  const state = async (id) => (await service.list(ownerId, true)).find((row) => row.id === id);
  return {
    ownerId,
    mode,
    principal,
    service,
    createService,
    add,
    enqueue,
    state,
    copies: () => copies,
  };
}
for (const mode of ['PHOTO', 'MATERIAL']) {
  test(`${mode} accepts a frozen selection without running it, resumes on another instance and commits one item at a time`, async () => {
    const f = await fixture(mode),
      rows = [await f.add(), await f.add()];
    const receipt = await f.enqueue('TRASH', rows);
    assert.equal(receipt.state, 'QUEUED');
    assert.equal(receipt.queued, 2);
    assert.equal(
      await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
      0,
    );
    const replay = await f.enqueue('TRASH', [...rows].reverse(), receipt.id);
    assert.equal(replay.id, receipt.id);
    assert.equal(
      await prisma.eagleAssetOperationItem.count({ where: { operationId: receipt.id } }),
      2,
    );
    const resumed = f.createService();
    await resumed.tick();
    assert.equal((await f.state(receipt.id)).completed, 1);
    assert.equal((await f.state(receipt.id)).queued, 1);
    await resumed.tick();
    assert.equal((await f.state(receipt.id)).state, 'COMPLETED');
    const restore = await f.enqueue('RESTORE', rows);
    await resumed.tick();
    await resumed.tick();
    assert.equal((await f.state(restore.id)).completed, 2);
    assert.equal(
      await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: null } }),
      2,
    );
  });
}
test('scope, privacy and command identity fail closed and no partial selection is queued', async () => {
  const f = await fixture(),
    other = await fixture(),
    row = await f.add(),
    foreign = await other.add(),
    material = await f.add({ libraryMode: 'MATERIAL' }),
    hidden = await f.add({ isPrivate: true });
  for (const resource of [foreign, material, hidden])
    await assert.rejects(f.enqueue('TRASH', [row, resource]), /不存在/);
  assert.equal(await prisma.eagleAssetOperation.count({ where: { ownerId: f.ownerId } }), 0);
  const receipt = await f.enqueue('SEND', [row]);
  await assert.rejects(other.service.retry(other.principal, receipt.id), /不存在/);
  await assert.rejects(other.service.cancel(other.principal, receipt.id), /不存在/);
  await assert.rejects(other.enqueue('SEND', [foreign], receipt.id), /不存在/);
  await assert.rejects(f.enqueue('TRASH', [row], receipt.id), /不一致/);
  assert.deepEqual(await other.service.list(other.ownerId, false), []);
  const materials = new EagleAssetOperationService(
    prisma,
    {},
    new EagleService(prisma, undefined, 'MATERIAL'),
    'MATERIAL',
  );
  assert.deepEqual(await materials.list(f.ownerId, true), []);
  await assert.rejects(materials.retry(f.principal, receipt.id), /不存在/);
});
test('a failed copy does not block later items and retry reuses durable target identities', async () => {
  let failures = 1;
  const f = await fixture('PHOTO', async () => {
    if (failures-- > 0) throw Error('synthetic storage failure with secret text');
  });
  const rows = [await f.add(), await f.add()],
    receipt = await f.enqueue('SEND', rows);
  assert.equal(f.copies(), 0);
  await f.service.tick();
  await f.service.tick();
  const partial = await f.state(receipt.id);
  assert.equal(partial.failed, 1);
  assert.equal(partial.completed, 1);
  assert.deepEqual(partial.errors, [{ code: 'OPERATION_FAILED', count: 1 }]);
  assert.ok(!JSON.stringify(partial).includes('secret text'));
  const plans = await prisma.eagleLibraryTransfer.findMany({
    where: { ownerId: f.ownerId },
    orderBy: { id: 'asc' },
  });
  const before = plans.map((row) => [row.id, row.plan]);
  await f.service.retry(f.principal, receipt.id);
  await f.createService().tick();
  assert.equal((await f.state(receipt.id)).state, 'COMPLETED');
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    2,
  );
  assert.deepEqual(
    (
      await prisma.eagleLibraryTransfer.findMany({
        where: { ownerId: f.ownerId },
        orderBy: { id: 'asc' },
      })
    ).map((row) => [row.id, row.plan]),
    before,
  );
});
test('a live lease excludes other executors and stopping cancels only the waiting tail', async () => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture('PHOTO', async () => {
    entered.resolve();
    await finish.promise;
  });
  const receipt = await f.enqueue('SEND', [await f.add(), await f.add()]);
  const processing = f.service.tick();
  await entered.promise;
  await f.createService().tick();
  assert.equal(f.copies(), 1);
  const stopped = await f.service.cancel(f.principal, receipt.id);
  assert.equal(stopped.running, 1);
  assert.equal(stopped.cancelled, 1);
  finish.resolve();
  await processing;
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.state, 'STOPPED');
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    1,
  );
});
test('a crash after transfer publication replays the result without making another resource', async () => {
  const f = await fixture(),
    receipt = await f.enqueue('SEND', [await f.add()]);
  await f.service.tick();
  const copies = f.copies();
  const item = await prisma.eagleAssetOperationItem.findFirstOrThrow({
    where: { operationId: receipt.id },
  });
  await prisma.eagleAssetOperationItem.update({
    where: { id: item.id },
    data: { status: 'RUNNING', leaseUntil: new Date(0) },
  });
  await prisma.user.update({ where: { id: f.ownerId }, data: { authVersion: 1 } });
  await f.createService().tick();
  assert.equal(f.copies(), copies);
  assert.equal((await f.state(receipt.id)).completed, 1);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    1,
  );
});
test('account revocation during copying blocks publication, and explicit retry reauthorizes the same plan', async () => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture('PHOTO', async () => {
    entered.resolve();
    await finish.promise;
  });
  const row = await f.add(),
    receipt = await f.enqueue('SEND', [row, await f.add()]);
  const processing = f.service.tick();
  await entered.promise;
  await prisma.user.update({ where: { id: f.ownerId }, data: { authVersion: 1 } });
  finish.resolve();
  await processing;
  assert.equal((await f.state(receipt.id)).failed, 2);
  assert.equal((await f.state(receipt.id)).errors[0].code, 'AUTH_REQUIRED');
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    0,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    null,
  );
  f.principal.authVersion = 1;
  await f.service.retry(f.principal, receipt.id);
  await f.service.tick();
  await f.service.tick();
  assert.equal((await f.state(receipt.id)).completed, 2);
});
test('changed or disabled sources are not mutated and failed work remains explicit', async () => {
  const f = await fixture(),
    row = await f.add(),
    receipt = await f.enqueue('TRASH', [row]);
  await prisma.eagleAsset.update({ where: { id: row.id }, data: { rowVersion: { increment: 1 } } });
  await f.service.tick();
  assert.equal((await f.state(receipt.id)).errors[0].code, 'ASSET_CHANGED');
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    null,
  );
  const next = await f.enqueue('TRASH', [row]);
  await prisma.user.update({ where: { id: f.ownerId }, data: { disabledAt: new Date() } });
  await f.service.tick();
  assert.equal((await f.state(next.id)).errors[0].code, 'AUTH_REQUIRED');
});
test('private jobs stay hidden while locked and cannot execute with an expired private grant', async () => {
  const f = await fixture(),
    row = await f.add({ isPrivate: true });
  f.principal.canViewPrivate = true;
  f.principal.privacyVisibleUntil = new Date(Date.now() + 60000).toISOString();
  const receipt = await f.enqueue('TRASH', [row]);
  assert.deepEqual(await f.service.list(f.ownerId, false), []);
  await prisma.eagleAssetOperation.update({
    where: { id: receipt.id },
    data: { privateUntil: new Date(0) },
  });
  await f.service.tick();
  assert.equal((await f.state(receipt.id)).errors[0].code, 'PRIVATE_LOCKED');
  await assert.rejects(
    f.service.retry({ ...f.principal, canViewPrivate: false }, receipt.id),
    /不存在/,
  );
  await f.service.retry(f.principal, receipt.id);
  await f.service.tick();
  assert.equal((await f.state(receipt.id)).completed, 1);
});
test('clear trash is queued, excludes resources trashed after acceptance, and uses the existing purge queue', async () => {
  const f = await fixture(),
    old = await f.add({ deletedAt: new Date(Date.now() - 10000) }),
    fresh = await f.add();
  const receipt = await f.enqueue('EMPTY_TRASH', []);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: old.id } })).purgeAfter,
    null,
  );
  await prisma.eagleAsset.update({
    where: { id: fresh.id },
    data: { deletedAt: new Date(Date.now() + 1000) },
  });
  await f.service.tick();
  assert.equal((await f.state(receipt.id)).completed, 1);
  assert.ok((await prisma.eagleAsset.findUniqueOrThrow({ where: { id: old.id } })).purgeAfter);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: fresh.id } })).purgeAfter,
    null,
  );
  assert.equal(
    await prisma.eagleAssetProcessingJob.count({
      where: { ownerId: f.ownerId, kind: 'PURGE_ASSET' },
    }),
    1,
  );
});
test('a stale executor cannot publish after another instance takes over its lease', async () => {
  const entered = deferred(),
    finish = deferred();
  let first = true;
  const f = await fixture('PHOTO', async () => {
    if (first) {
      first = false;
      entered.resolve();
      await finish.promise;
    }
  });
  const receipt = await f.enqueue('SEND', [await f.add()]);
  const oldExecutor = f.service.tick();
  await entered.promise;
  await prisma.eagleAssetOperationItem.updateMany({
    where: { operationId: receipt.id },
    data: { leaseUntil: new Date(0) },
  });
  await f.createService().tick();
  finish.resolve();
  await oldExecutor;
  assert.equal((await f.state(receipt.id)).completed, 1);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    1,
  );
});
test('live photo components remain atomic and a changed pairing stops the frozen operation', async () => {
  const f = await fixture();
  const identifier = randomUUID();
  const still = await f.add({ livePhotoIdentifier: identifier, livePhotoRole: 'STILL' });
  const motion = await f.add({
    mimeType: 'video/quicktime',
    format: 'mov',
    livePhotoIdentifier: identifier,
    livePhotoRole: 'MOTION',
  });
  await prisma.eagleAssetRendition.create({
    data: {
      assetId: motion.id,
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      kind: 'PREVIEW',
      variant: 'default',
      revision: 1,
      storageKey: `users/${f.ownerId}/assets/${motion.id}/preview.mp4`,
      mimeType: 'video/mp4',
      byteSize: 1,
      status: 'READY',
    },
  });
  const trash = await f.enqueue('TRASH', [still]);
  assert.equal(await prisma.eagleAssetOperationItem.count({ where: { operationId: trash.id } }), 1);
  await f.service.tick();
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
    2,
  );
  const restore = await f.enqueue('RESTORE', [still]);
  await f.service.tick();
  assert.equal((await f.state(restore.id)).completed, 1);
  const send = await f.enqueue('SEND', [still]);
  // Losing the playable motion changes the logical resource without a rowVersion bump.
  await prisma.eagleAssetRendition.updateMany({
    where: { assetId: motion.id },
    data: { status: 'FAILED' },
  });
  await f.service.tick();
  assert.equal((await f.state(send.id)).errors[0].code, 'ASSET_CHANGED');
  assert.equal(f.copies(), 0);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: null } }),
    2,
  );
});

test('cancelling during claim discovery cannot resurrect a cancelled item', async () => {
  const f = await fixture(),
    row = await f.add();
  const receipt = await f.enqueue('TRASH', [row]);
  let intercepted = false;
  const competing = prisma.$extends({
    query: {
      eagleAssetOperationItem: {
        async findFirst({ args, query }) {
          const result = await query(args);
          if (result && !intercepted) {
            intercepted = true;
            await f.service.cancel(f.principal, receipt.id);
          }
          return result;
        },
      },
    },
  });
  await f.createService(competing).tick();
  assert.equal(intercepted, true);
  assert.equal((await f.state(receipt.id)).cancelled, 1);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    null,
  );
});
