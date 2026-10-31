import { OPERATION_SEND_CONCURRENCY } from '../../apps/api/dist/eagle/eagle-operation-settings.js';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import console from 'node:console';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { EagleLibraryTransferService } from '../../apps/api/dist/eagle/eagle-library-transfer.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { drainObjectDeletion } from '../../apps/worker/dist/asset-purge.js';
import { lockOwnerPrivacyProjection } from '../../packages/library-persistence/dist/privacy-lock.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let queryCount = 0;
let transactionCount = 0;
let deletionClaimQuery = '';
prisma.$on('query', ({ query }) => {
  queryCount++;
  if (query.trim().startsWith('BEGIN')) transactionCount++;
  if (query.includes('UPDATE "EagleObjectDeletion" d')) deletionClaimQuery = query;
});
const owners = [];
afterEach(async () => {
  const ownerIds = owners.splice(0);
  await prisma.eagleAssetOperation.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.eagleObjectDeletion.deleteMany({ where: { ownerId: { in: ownerIds } } });
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
  const transferDb = copy
    ? prisma.$extends({
        query: {
          eagleLibraryTransfer: {
            create({ args, query }) {
              if (Array.isArray(args.data.plan))
                args.data.plan = args.data.plan.map((item) => ({
                  ...item,
                  storageAction: undefined,
                  targetKey: `users/${ownerId}/assets/${item.targetId}/original.jpg`,
                  renditions: (item.renditions ?? []).map((r) => ({
                    ...r,
                    targetKey: `users/${ownerId}/assets/${item.targetId}/transfer/${r.id}`,
                  })),
                  ...(item.pyramid
                    ? {
                        pyramid: {
                          ...item.pyramid,
                          targetPrefix: `users/${ownerId}/assets/${item.targetId}/pyramids/1/transfer-${item.pyramid.id}/`,
                        },
                      }
                    : {}),
                }));
              return query(args);
            },
          },
        },
      })
    : prisma;
  const createService = (db = prisma, transfer = transferDb) =>
    new EagleAssetOperationService(
      db,
      new EagleLibraryTransferService(transfer, storage, mode),
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
  test(`${mode} local admission executes after commit without waiting for the five-second recovery poll`, async () => {
    const f = await fixture(mode);
    const asset = await f.add();
    f.service.startExecutor();
    try {
      const receipt = await f.enqueue('TRASH', [asset]);
      // This deadline is shorter than the recovery poll, so completion requires
      // the post-commit local wake rather than a lucky timer tick.
      const deadline = performance.now() + 3000;
      let state;
      do {
        state = await f.state(receipt.id);
        if (state.completed === 1) break;
        await delay(10);
      } while (performance.now() < deadline);
      assert.equal(state.completed, 1);
      assert.ok((await prisma.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).deletedAt);
    } finally {
      f.service.onModuleDestroy();
    }
  });
  test(`${mode} accepts a frozen selection without running it and resumes a bounded batch on another instance`, async () => {
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
    assert.equal((await f.state(receipt.id)).completed, 2);
    assert.equal((await f.state(receipt.id)).queued, 0);
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
test('scope, privacy and command identity fail closed per resource while valid deletion items continue', async () => {
  const f = await fixture(),
    other = await fixture(),
    row = await f.add(),
    foreign = await other.add(),
    material = await f.add({ libraryMode: 'MATERIAL' }),
    hidden = await f.add({ isPrivate: true });
  for (const resource of [foreign, material, hidden]) {
    await assert.rejects(f.enqueue('TRASH', [resource]), /不存在/);
    const owned = await f.add();
    const partial = await f.enqueue('TRASH', [owned, resource]);
    assert.equal(partial.queued, 1);
    assert.equal(partial.failed, 1);
    assert.deepEqual(partial.errors, [{ code: 'NOT_FOUND', count: 1 }]);
    await f.service.tick();
    assert.equal((await f.state(partial.id)).completed, 1);
    assert.equal(
      (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: resource.id } })).deletedAt,
      null,
    );
  }
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
  const receipt = await f.enqueue(
    'SEND',
    await Promise.all(Array.from({ length: 6 }, () => f.add())),
  );
  const processing = f.service.tick();
  await entered.promise;
  await f.createService().tick();
  assert.equal(f.copies(), 4);
  const stopped = await f.service.cancel(f.principal, receipt.id);
  assert.equal(stopped.running, 4);
  assert.equal(stopped.cancelled, 2);
  finish.resolve();
  await processing;
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 4);
  assert.equal(result.cancelled, 2);
  assert.equal(result.state, 'STOPPED');
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    4,
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

test('a blocked SEND does not block trash; a second executor cannot steal either live lane', async () => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture('PHOTO', async () => {
    entered.resolve();
    await finish.promise;
  });
  const send = await f.enqueue('SEND', [await f.add()]);
  const processing = f.service.tick();
  await entered.promise;
  try {
    const trash = await f.enqueue('TRASH', [await f.add(), await f.add()]);
    await f.createService().tick();
    assert.equal((await f.state(trash.id)).completed, 2);
    assert.equal((await f.state(send.id)).running, 1);
    assert.equal(f.copies(), 1);
  } finally {
    finish.resolve();
    await processing;
  }
});

test('metadata batches are bounded and commit one bulk resource write per batch', async () => {
  const f = await fixture();
  const rows = [];
  for (let i = 0; i < 65; i++) rows.push(await f.add());
  const receipt = await f.enqueue('TRASH', rows);
  let writes = 0;
  const db = prisma.$extends({
    query: {
      eagleAsset: {
        async updateMany({ args, query }) {
          writes++;
          return query(args);
        },
      },
    },
  });
  const executor = f.createService(db);
  const start = performance.now();
  await executor.tick();
  assert.equal((await f.state(receipt.id)).completed, 32);
  assert.equal(writes, 1);
  await executor.tick();
  await executor.tick();
  assert.equal((await f.state(receipt.id)).completed, 65);
  assert.equal(writes, 3);
  console.log(
    `Synthetic 65-item trash: ${(performance.now() - start).toFixed(1)} ms, ${writes} bulk writes`,
  );
});

test('a changed item rolls back the bulk attempt and preserves individual results', async () => {
  const f = await fixture();
  const rows = [await f.add(), await f.add(), await f.add()];
  const receipt = await f.enqueue('TRASH', rows);
  await prisma.eagleAsset.update({
    where: { id: rows[1].id },
    data: { rowVersion: { increment: 1 } },
  });
  await f.service.tick();
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.errors, [{ code: 'ASSET_CHANGED', count: 1 }]);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: rows[1].id } })).deletedAt,
    null,
  );
});

for (const size of [128, 477, 1000])
  test(`${size} synthetic resources complete with bounded database work`, async () => {
    const f = await fixture();
    const rows = [];
    for (let i = 0; i < size; i++) rows.push(await f.add());
    const receipt = await f.enqueue('TRASH', rows);
    let writes = 0,
      ticks = 0;
    const db = prisma.$extends({
      query: {
        eagleAsset: {
          async updateMany({ args, query }) {
            writes++;
            return query(args);
          },
        },
      },
    });
    const executor = f.createService(db);
    const start = performance.now();
    const startQueries = queryCount;
    while ((await f.state(receipt.id)).completed < rows.length && ticks < rows.length) {
      await executor.tick();
      ticks++;
    }
    console.log(
      JSON.stringify({
        benchmark: `trash-${size}`,
        milliseconds: performance.now() - start,
        ticks,
        resourceWrites: writes,
        sqlStatements: queryCount - startQueries,
      }),
    );
    assert.equal((await f.state(receipt.id)).completed, size);
    assert.equal(writes, Math.ceil(size / 32));
  });

test('batching cannot conceal live components reassigned between selected resources', async () => {
  const f = await fixture();
  const firstIdentifier = randomUUID(),
    secondIdentifier = randomUUID();
  const first = await f.add({ livePhotoIdentifier: firstIdentifier, livePhotoRole: 'STILL' });
  const second = await f.add({ livePhotoIdentifier: secondIdentifier, livePhotoRole: 'STILL' });
  const motion = await f.add({
    livePhotoIdentifier: firstIdentifier,
    livePhotoRole: 'MOTION',
    mimeType: 'video/quicktime',
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
  const receipt = await f.enqueue('TRASH', [first, second]);
  // Pairing is derived from current metadata, not covered by the frozen row versions.
  await prisma.eagleAsset.update({
    where: { id: motion.id },
    data: { livePhotoIdentifier: secondIdentifier },
  });
  await f.service.tick();
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 2);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
    0,
  );
});

test('cancelling a metadata command preserves the committed batch and cancels its waiting tail', async () => {
  const f = await fixture();
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(await f.add());
  const command = await f.enqueue('TRASH', rows);
  await f.service.tick();
  const result = await f.service.cancel(f.principal, command.id);
  assert.equal(result.completed, 32);
  assert.equal(result.cancelled, 8);
  await f.createService().tick();
  assert.equal((await f.state(command.id)).completed, 32);
});

test('an expired metadata batch cannot publish or overwrite its replacement generation', async () => {
  const f = await fixture();
  const rows = [await f.add(), await f.add()];
  const command = await f.enqueue('TRASH', rows);
  const entered = deferred(),
    resume = deferred();
  let intercepted = false;
  const delayed = {
    eagleAssetOperationItem: prisma.eagleAssetOperationItem,
    async $transaction(...args) {
      const result = await prisma.$transaction(...args);
      // Pause after the claim commits and before the write transaction begins;
      // a real paused process holds no transaction locks during takeover.
      if (!intercepted && Array.isArray(result) && result[0]?.operation?.kind === 'TRASH') {
        intercepted = true;
        entered.resolve();
        await resume.promise;
      }
      return result;
    },
  };
  const stale = f.createService(delayed).tick();
  await entered.promise;
  try {
    await prisma.eagleAssetOperationItem.updateMany({
      where: { operationId: command.id },
      data: { leaseUntil: new Date(0) },
    });
    await f.createService().tick();
    assert.equal((await f.state(command.id)).completed, 2);
  } finally {
    resume.resolve();
    await stale;
  }
  assert.equal((await f.state(command.id)).completed, 2);
  const resources = await prisma.eagleAsset.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  assert.ok(resources.every((row) => row.deletedAt && row.rowVersion === rows[0].rowVersion + 1));
});

test('object cleanup claims a bounded batch and deletes keys in bulk without waiting for another poll', async () => {
  const f = await fixture();
  await prisma.eagleObjectDeletion.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      createdAt: new Date(0),
      availableAt: new Date(0),
      objectKeys: [`users/${f.ownerId}/${i}-original`, `users/${f.ownerId}/${i}-preview`],
      prefixes: [],
    })),
  });
  let individual = 0,
    bulk = 0;
  const count = await drainObjectDeletion(prisma, {
    deleteObject: async () => {
      individual++;
    },
    deleteObjects: async (keys) => {
      bulk++;
      assert.equal(keys.length, 2);
    },
    deletePrefix: async () => {},
  });
  assert.equal(await prisma.eagleObjectDeletion.count({ where: { ownerId: f.ownerId } }), 4);
  assert.equal(count, 4);
  assert.equal(bulk, 4);
  assert.equal(individual, 0);
});

test('a failed or unsafe cleanup receipt never deletes foreign keys or loses its retry state', async () => {
  const f = await fixture();
  const rows = await Promise.all([
    prisma.eagleObjectDeletion.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        createdAt: new Date(0),
        availableAt: new Date(0),
        objectKeys: [`users/${f.ownerId}/valid`, 'users/foreign/private'],
        prefixes: [],
      },
    }),
    prisma.eagleObjectDeletion.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        createdAt: new Date(0),
        availableAt: new Date(0),
        objectKeys: [`users/${f.ownerId}/retry`],
        prefixes: [],
      },
    }),
  ]);
  const deleted = [];
  await drainObjectDeletion(prisma, {
    deleteObject: async (key) => {
      deleted.push(key);
      throw Error('synthetic failure');
    },
    deleteObjects: async (keys) => {
      deleted.push(...keys);
      throw Error('synthetic failure');
    },
    deletePrefix: async () => {},
  });
  assert.deepEqual(
    deleted.filter((key) => key.startsWith(`users/${f.ownerId}/`)),
    [`users/${f.ownerId}/retry`],
  );
  assert.ok(!deleted.includes('users/foreign/private'));
  const remaining = await prisma.eagleObjectDeletion.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  assert.equal(remaining.length, 2);
  assert.ok(
    remaining.every(
      (row) => row.status === 'PENDING' && row.availableAt > new Date() && row.leaseVersion === 1,
    ),
  );
});

test('a metadata batch waits for a bounded publication lock without failing its entire selection', async () => {
  const f = await fixture();
  const receipt = await f.enqueue('TRASH', [await f.add(), await f.add()]);
  const entered = deferred(),
    release = deferred();
  const holder = prisma.$transaction(
    async (tx) => {
      await lockOwnerPrivacyProjection(tx, f.ownerId, 'PHOTO');
      entered.resolve();
      await release.promise;
    },
    { timeout: 10000 },
  );
  await entered.promise;
  const processing = f.service.tick();
  try {
    await delay(5500);
  } finally {
    release.resolve();
    await holder;
    await processing;
  }
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
});

test('a private grant expiring during the bulk write rolls back resources and all receipts', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture();
  f.principal.canViewPrivate = true;
  f.principal.privacyVisibleUntil = new Date(Date.now() + 60000).toISOString();
  const receipt = await f.enqueue('TRASH', [
    await f.add({ isPrivate: true }),
    await f.add({ isPrivate: true }),
  ]);
  let wrote = false;
  const delayed = prisma.$extends({
    query: {
      eagleAsset: {
        async updateMany({ args, query }) {
          const result = await query(args);
          wrote = true;
          t.mock.timers.tick(60001);
          return result;
        },
      },
    },
  });
  await f.createService(delayed).tick();
  assert.equal(wrote, true);
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.errors, [{ code: 'PRIVATE_LOCKED', count: 2 }]);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
    0,
  );
});

test('conflicting send and trash cannot both publish the same frozen source', async () => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture('PHOTO', async () => {
    entered.resolve();
    await finish.promise;
  });
  const row = await f.add();
  const send = await f.enqueue('SEND', [row]);
  const sending = f.service.tick();
  await entered.promise;
  try {
    const trash = await f.enqueue('TRASH', [row]);
    await f.service.tick();
    assert.equal((await f.state(trash.id)).completed, 1);
  } finally {
    finish.resolve();
    await sending;
  }
  assert.equal((await f.state(send.id)).completed, 0);
  assert.equal((await f.state(send.id)).failed, 1);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    0,
  );
});

test('cleanup discovery reads a bounded window from a 50k due backlog', async () => {
  const f = await fixture();
  try {
    for (let offset = 0; offset < 50000; offset += 1000)
      await prisma.eagleObjectDeletion.createMany({
        data: Array.from({ length: 1000 }, (_, i) => ({
          ownerId: f.ownerId,
          libraryMode: 'PHOTO',
          objectKeys: [`users/${f.ownerId}/scale-${offset + i}`],
          prefixes: [],
          createdAt: new Date(0),
          availableAt: new Date(0),
        })),
      });
    await prisma.$executeRawUnsafe('ANALYZE "EagleObjectDeletion"');
    deletionClaimQuery = '';
    await drainObjectDeletion(prisma, {
      deleteObjects: async () => {},
      deletePrefix: async () => {},
    });
    assert.ok(deletionClaimQuery);
    const result = await prisma.$queryRawUnsafe(
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + deletionClaimQuery,
    );
    const plan = result[0]['QUERY PLAN'][0];
    function scanned(node) {
      const own =
        ['Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan'].includes(
          node['Node Type'],
        ) && node['Relation Name'] === 'EagleObjectDeletion'
          ? node['Actual Rows'] * node['Actual Loops']
          : 0;
      return own + (node.Plans ?? []).reduce((sum, child) => sum + scanned(child), 0);
    }
    const visited = scanned(plan.Plan);
    console.log(
      JSON.stringify({
        benchmark: 'cleanup-discovery-50k',
        scannedRows: visited,
        milliseconds: plan['Execution Time'],
      }),
    );
    assert.ok(visited < 1000, `four-receipt discovery visited ${visited} rows`);
  } finally {
    await prisma.eagleObjectDeletion.deleteMany({ where: { ownerId: f.ownerId } });
    await prisma.$executeRawUnsafe('ANALYZE "EagleObjectDeletion"');
  }
});

test('cleanup chunks 2001 keys and safely retries after a partially successful second chunk', async () => {
  const f = await fixture();
  const keys = Array.from({ length: 2001 }, (_, i) => `users/${f.ownerId}/chunk-${i}`);
  const objects = new Set([...keys, 'users/foreign/keep']);
  const receipt = await prisma.eagleObjectDeletion.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      objectKeys: keys,
      prefixes: [],
      availableAt: new Date(0),
    },
  });
  const sizes = [];
  const storage = {
    deletePrefix: async () => {},
    deleteObjects: async (part) => {
      if (!part[0]?.startsWith(`users/${f.ownerId}/`)) return;
      sizes.push(part.length);
      if (sizes.length === 2) {
        for (const key of part.slice(0, -1)) objects.delete(key);
        throw Error('synthetic partial DeleteObjects failure');
      }
      for (const key of part) objects.delete(key);
    },
  };
  await drainObjectDeletion(prisma, storage);
  assert.deepEqual(sizes, [1000, 1000]);
  const pending = await prisma.eagleObjectDeletion.findUniqueOrThrow({ where: { id: receipt.id } });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.leaseVersion, 1);
  await prisma.eagleObjectDeletion.update({
    where: { id: receipt.id },
    data: { availableAt: new Date(0) },
  });
  await drainObjectDeletion(prisma, storage);
  assert.deepEqual(sizes, [1000, 1000, 1000, 1000, 1]);
  assert.deepEqual([...objects], ['users/foreign/keep']);
  assert.equal(await prisma.eagleObjectDeletion.findUnique({ where: { id: receipt.id } }), null);
});

test('a stale cleanup executor cannot remove a replacement receipt while its new lease is active', async () => {
  const f = await fixture();
  const receipt = await prisma.eagleObjectDeletion.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      objectKeys: [`users/${f.ownerId}/leased`],
      prefixes: [],
      availableAt: new Date(0),
    },
  });
  const firstEntered = deferred(),
    secondEntered = deferred(),
    firstFinish = deferred(),
    secondFinish = deferred();
  let calls = 0;
  const storage = {
    deletePrefix: async () => {},
    deleteObjects: async (keys) => {
      if (!keys[0]?.startsWith(`users/${f.ownerId}/`)) return;
      if (++calls === 1) {
        firstEntered.resolve();
        await firstFinish.promise;
      } else {
        secondEntered.resolve();
        await secondFinish.promise;
      }
    },
  };
  const old = drainObjectDeletion(prisma, storage);
  await firstEntered.promise;
  let replacement;
  try {
    await prisma.eagleObjectDeletion.update({
      where: { id: receipt.id },
      data: { lockedAt: new Date(0) },
    });
    replacement = drainObjectDeletion(prisma, storage);
    await secondEntered.promise;
    firstFinish.resolve();
    await old;
    const held = await prisma.eagleObjectDeletion.findUniqueOrThrow({ where: { id: receipt.id } });
    assert.equal(held.leaseVersion, 2);
    assert.equal(held.status, 'PROCESSING');
  } finally {
    firstFinish.resolve();
    secondFinish.resolve();
    await old;
    await replacement;
  }
  assert.equal(await prisma.eagleObjectDeletion.findUnique({ where: { id: receipt.id } }), null);
});

test('a live metadata batch excludes other executors from claiming its waiting tail', async () => {
  const f = await fixture(),
    rows = [];
  for (let i = 0; i < 40; i++) rows.push(await f.add());
  const receipt = await f.enqueue('TRASH', rows);
  const entered = deferred(),
    release = deferred();
  let paused = false;
  const adapter = {
    eagleAssetOperationItem: prisma.eagleAssetOperationItem,
    async $transaction(...args) {
      const result = await prisma.$transaction(...args);
      if (!paused && Array.isArray(result) && result[0]?.operation?.kind === 'TRASH') {
        paused = true;
        entered.resolve();
        await release.promise;
      }
      return result;
    },
  };
  const first = f.createService(adapter).tick();
  await entered.promise;
  try {
    await f.createService().tick();
    const state = await f.state(receipt.id);
    assert.equal(state.running, 32);
    assert.equal(state.queued, 8);
    assert.equal(state.completed, 0);
  } finally {
    release.resolve();
    await first;
  }
  await f.createService().tick();
  assert.equal((await f.state(receipt.id)).completed, 40);
});

test('a mismatched live pair fails individually while an unaffected pair is trashed atomically', async () => {
  const f = await fixture(),
    pairs = [];
  for (let i = 0; i < 2; i++) {
    const livePhotoIdentifier = randomUUID();
    const still = await f.add({ livePhotoIdentifier, livePhotoRole: 'STILL' });
    const motion = await f.add({
      livePhotoIdentifier,
      livePhotoRole: 'MOTION',
      mimeType: 'video/quicktime',
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
    pairs.push({ still, motion });
  }
  const receipt = await f.enqueue(
    'TRASH',
    pairs.map((pair) => pair.still),
  );
  await prisma.eagleAssetRendition.updateMany({
    where: { assetId: pairs[0].motion.id },
    data: { status: 'FAILED' },
  });
  await f.service.tick();
  const state = await f.state(receipt.id);
  assert.equal(state.completed, 1);
  assert.equal(state.failed, 1);
  for (let i = 0; i < pairs.length; i++)
    for (const row of [pairs[i].still, pairs[i].motion]) {
      const actual = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(actual.deletedAt !== null, i === 1);
    }
});

test('a source disappearing after admission is an idempotent trash no-op and does not block valid peers', async () => {
  const f = await fixture();
  const gone = await f.add(),
    keep = await f.add();
  const receipt = await f.enqueue('TRASH', [gone, keep]);
  await prisma.eagleAsset.delete({ where: { id: gone.id } });
  await f.service.tick();
  const result = await f.state(receipt.id);
  assert.equal(result.completed, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.notEqual(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: keep.id } })).deletedAt,
    null,
  );
});

test('a 60000-item selection is one durable operation with bounded SQL batches and no storage I/O', async () => {
  const f = await fixture();
  const ids = Array.from({ length: 60000 }, () => randomUUID());
  for (let offset = 0; offset < ids.length; offset += 512)
    await prisma.eagleAsset.createMany({
      data: ids.slice(offset, offset + 512).map((id) => ({
        id,
        ownerId: f.ownerId,
        libraryMode: f.mode,
        originalName: 'scale.jpg',
        displayName: 'Scale',
        normalizedDisplayName: 'scale',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        originalObjectKey: `users/${f.ownerId}/assets/${id}/original.jpg`,
        lifecycleStatus: 'READY',
        mediaRevision: 1,
      })),
    });
  try {
    const before = queryCount,
      start = performance.now();
    const receipt = await f.service.enqueue(f.principal, {
      operationId: randomUUID(),
      kind: 'SEND',
      assetIds: ids,
    });
    const admission = {
      count: ids.length,
      durationMs: Math.round(performance.now() - start),
      sql: queryCount - before,
      storageCopies: f.copies(),
    };
    console.log('Large selection admission:', JSON.stringify(admission));
    assert.equal(receipt.total, 60000);
    assert.equal(receipt.queued, 60000);
    assert.equal(receipt.failed, 0);
    assert.equal(f.copies(), 0);
    assert(
      admission.sql < 1000,
      'admission queries must scale by internal chunks, not one query per resource',
    );
  } finally {
    await prisma.eagleAssetOperation.deleteMany({ where: { ownerId: f.ownerId } });
    await prisma.eagleAsset.deleteMany({ where: { ownerId: f.ownerId } });
  }
});

test('a 100-photo send measures the complete queue cost without object copies', async () => {
  const f = await fixture();
  const rows = await Promise.all(Array.from({ length: 100 }, () => f.add()));
  const beforeAdmission = queryCount,
    beforeAdmissionTransactions = transactionCount,
    admissionStart = performance.now();
  const receipt = await f.enqueue('SEND', rows);
  const admission = {
    sql: queryCount - beforeAdmission,
    transactions: transactionCount - beforeAdmissionTransactions,
    durationMs: Math.round(performance.now() - admissionStart),
  };
  const beforeExecution = queryCount,
    beforeExecutionTransactions = transactionCount,
    executionStart = performance.now();
  for (let cursor = 0; cursor < rows.length; cursor += 4) await f.service.tick();
  const execution = {
    sql: queryCount - beforeExecution,
    transactions: transactionCount - beforeExecutionTransactions,
    durationMs: Math.round(performance.now() - executionStart),
  };
  const outcome = await f.state(receipt.id);
  assert.equal(outcome.completed, rows.length);
  assert.equal(outcome.failed, 0);
  assert.equal(f.copies(), 0);
  console.log(
    'Complete send cost:',
    JSON.stringify({
      count: rows.length,
      admission,
      execution,
      s3Copies: f.copies(),
      syntheticNoExifTagsOrRenditions: true,
    }),
  );
  assert(
    execution.sql <= 3800,
    'plain handoff must not repeat snapshot/journal reads outside its publication transaction',
  );
  assert(
    execution.transactions <= 150,
    'plain handoff must not open redundant validation/upsert transactions',
  );
});

test('a failed atomic send receipt rolls back target and source retirement, then retries the same plan', async () => {
  const f = await fixture();
  const source = await f.add(),
    receipt = await f.enqueue('SEND', [source]);
  let fail = true;
  const injected = prisma.$extends({
    query: {
      eagleAssetOperationItem: {
        updateMany({ args, query }) {
          if (args.data.status === 'COMPLETED' && fail) {
            fail = false;
            throw new Error('synthetic receipt interruption');
          }
          return query(args);
        },
      },
    },
  });
  const service = f.createService(injected, injected);
  await service.tick();
  assert.equal((await f.state(receipt.id)).failed, 1);
  const unchanged = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(unchanged.deletedAt, null);
  assert.equal(unchanged.storageTransferredOut, false);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    0,
  );
  const plan = await prisma.eagleLibraryTransfer.findFirstOrThrow({
    where: { ownerId: f.ownerId },
  });
  await service.retry(f.principal, receipt.id);
  await service.tick();
  assert.equal((await f.state(receipt.id)).completed, 1);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    1,
  );
  assert.equal(
    (await prisma.eagleLibraryTransfer.findUniqueOrThrow({ where: { id: plan.id } })).result
      .assets[0].assetId,
    plan.plan[0].targetId,
  );
});

test('large admission does not hold the owner privacy mutex or block unrelated workspace writes', async () => {
  const f = await fixture(),
    source = await f.add();
  const entered = deferred(),
    release = deferred();
  const holder = prisma.$transaction(
    async (tx) => {
      await lockOwnerPrivacyProjection(tx, f.ownerId, f.mode);
      entered.resolve();
      await release.promise;
    },
    { timeout: 30000 },
  );
  await entered.promise;
  let admitted = false,
    blocked = false,
    failure;
  const admission = f.enqueue('SEND', [source]).then(
    () => {
      admitted = true;
    },
    (error) => {
      failure = error;
    },
  );
  try {
    for (let check = 0; check < 200 && !admitted; check++) {
      const [waiting] =
        await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
      if (waiting.count) {
        blocked = true;
        break;
      }
      await delay(5);
    }
    assert.equal(
      blocked,
      false,
      'preparing a queue intent must not wait for or retain the workspace privacy lock',
    );
    assert.equal(admitted, true);
  } finally {
    release.resolve();
    await holder;
    await admission;
    if (failure) throw failure;
  }
});
