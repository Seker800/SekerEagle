import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createAssetOperationExecutors } from '../../apps/api/dist/asset-operation-executor.js';
import { lockOwnerPrivacyProjection } from '../../packages/library-persistence/dist/privacy-lock.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
const owners = [],
  evidence = [];
const storage = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('cancelled metadata must not access object storage');
    },
  },
);
const executors = createAssetOperationExecutors(db, storage);
after(async () => {
  for (const ownerId of owners) {
    await db.eagleAssetOperation.deleteMany({ where: { ownerId } });
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.eagleManualTag.deleteMany({ where: { ownerId } });
    await db.user.delete({ where: { id: ownerId } });
  }
  await db.$disconnect();
  mkdirSync('.omx/artifacts', { recursive: true });
  writeFileSync(
    '.omx/artifacts/operation-cancellation-results.json',
    JSON.stringify({ passed: evidence.length === 6, evidence }, null, 2),
  );
});
async function fixture(mode) {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  const service = executors[mode === 'PHOTO' ? 1 : 0];
  const principal = { sub: ownerId, authVersion: 0, canViewPrivate: false, kind: 'browser' };
  const add = async () => {
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
        byteSize: 1n,
        originalObjectKey: `users/${ownerId}/assets/${id}/original`,
        lifecycleStatus: 'READY',
        mediaRevision: 1,
      },
    });
  };
  return { ownerId, service, principal, add };
}
for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode} cancellation after cleanup claim and before publication prevents deletion and child expansion`, async () => {
    const f = await fixture(mode),
      asset = await f.add();
    const queued = await f.service.duplicates.cleanup(f.principal, {
      operationId: randomUUID(),
      groups: [{ signature: 'unresolved-synthetic-group', keepIds: [asset.id] }],
    });
    const claimed = await f.service.claim('METADATA');
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].operationId, queued.operationId);
    let release, ready;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const locked = new Promise((resolve) => {
      ready = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, f.ownerId, mode);
        ready();
        await held;
      },
      { timeout: 15000 },
    );
    await locked;
    const executing = f.service.execute(claimed);
    try {
      // Publication cannot acquire its privacy lock. Cancellation must still commit.
      await f.service.cancel(f.principal, queued.operationId);
    } finally {
      release();
      await blocker;
    }
    await executing;
    const items = await db.eagleAssetOperationItem.findMany({
      where: { operationId: queued.operationId },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'CANCELLED');
    assert.equal(items[0].errorCode, null);
    assert.equal(
      (await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).deletedAt,
      null,
    );
    assert.ok(
      (await db.eagleAssetOperation.findUniqueOrThrow({ where: { id: queued.operationId } }))
        .cancelRequestedAt,
    );
    evidence.push({
      mode,
      scenario: 'claimed-cleanup-publication-lock',
      children: 0,
      deleted: 0,
      state: items[0].status,
    });
  });
  test(`${mode} cancelled discovery cannot grow new scan items`, async () => {
    const f = await fixture(mode);
    await f.add();
    const queued = await f.service.duplicates.scan(f.principal, randomUUID());
    const claimed = await f.service.claim('SCAN');
    assert.equal(claimed.length, 1);
    await f.service.cancel(f.principal, queued.operationId);
    await f.service.execute(claimed);
    const items = await db.eagleAssetOperationItem.findMany({
      where: { operationId: queued.operationId },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'CANCELLED');
    await assert.rejects(
      db.$transaction((tx) =>
        f.service.duplicates.expandPreparedItems(tx, claimed[0], [
          { assetIds: [], snapshots: { kind: 'build', version: 1 }, weight: 1 },
        ]),
      ),
      /OPERATION_CANCELLED/,
    );
    assert.equal(
      await db.eagleAssetOperationItem.count({ where: { operationId: queued.operationId } }),
      1,
    );
    evidence.push({
      mode,
      scenario: 'claimed-scan-expansion',
      children: 0,
      state: items[0].status,
    });
  });
  test(`${mode} cancelled conflict partition cannot split and retry clears the durable intent`, async () => {
    const f = await fixture(mode),
      rows = await Promise.all([f.add(), f.add()]);
    const operation = await f.service.enqueueCommand(f.principal, {
      type: 'ASSET_UPDATE',
      assetIds: rows.map((row) => row.id),
      payload: {
        assets: rows.map((row) => ({ assetId: row.id, rowVersion: row.rowVersion })),
        rating: 4,
      },
    });
    const claimed = await f.service.claim('METADATA');
    assert.equal(claimed.length, 1);
    await f.service.cancel(f.principal, operation.id);
    await assert.rejects(f.service.splitLibraryCommand(claimed[0]), /OPERATION_CANCELLED/);
    await f.service.execute(claimed);
    assert.equal(
      await db.eagleAssetOperationItem.count({ where: { operationId: operation.id } }),
      1,
    );
    assert.equal(await db.eagleAsset.count({ where: { ownerId: f.ownerId, rating: 4 } }), 0);
    await f.service.retry(f.principal, operation.id);
    assert.equal(
      (await db.eagleAssetOperation.findUniqueOrThrow({ where: { id: operation.id } }))
        .cancelRequestedAt,
      null,
    );
    evidence.push({
      mode,
      scenario: 'cancelled-conflict-split',
      children: 0,
      writes: 0,
      retryClearedIntent: true,
    });
  });
}
