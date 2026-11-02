import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { setTimeout, clearTimeout } from 'node:timers';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { createAssetOperationBackground } from '../../apps/api/dist/asset-operation-executor.js';
import console from 'node:console';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { OPERATION_SEND_CONCURRENCY } from '../../apps/api/dist/eagle/eagle-operation-settings.js';
import { EagleLibraryTransferService } from '../../apps/api/dist/eagle/eagle-library-transfer.service.js';
import { EagleUploadService } from '../../apps/api/dist/eagle/eagle-upload.service.js';
import { EagleUploadRecoveryService } from '../../apps/api/dist/eagle/eagle-upload-recovery.service.js';
import { EagleMediaCapabilityService } from '../../apps/api/dist/eagle/eagle-media-capability.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient({
  adapter: createPrismaAdapter(),
  log: [{ emit: 'event', level: 'query' }],
});
let queries = [];
prisma.$on('query', (event) => queries.push(event));
after(() => prisma.$disconnect());
async function owner() {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, email: `${id}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  return id;
}
function asset(ownerId, libraryMode = 'PHOTO') {
  const id = randomUUID();
  return {
    id,
    ownerId,
    libraryMode,
    originalName: 'synthetic.jpg',
    displayName: 'synthetic',
    normalizedDisplayName: 'synthetic',
    mimeType: 'image/jpeg',
    format: 'jpeg',
    byteSize: 1n,
    originalObjectKey: `users/${ownerId}/assets/${id}/original.jpg`,
    mediaRevision: 1,
    lifecycleStatus: 'READY',
  };
}

for (const sourceMode of ['PHOTO', 'MATERIAL'])
  test(`${sourceMode} 100 shared-tag HANDOFFs amortize mappings and retain provenance/groups with zero S3`, async () => {
    const ownerId = await owner(),
      targetMode = sourceMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
    const rows = Array.from({ length: 100 }, () => asset(ownerId, sourceMode));
    await prisma.eagleAsset.createMany({ data: rows });
    const groups = await Promise.all(
      ['primary', 'extra'].map((name) =>
        prisma.eagleManualTagGroup.create({
          data: { ownerId, libraryMode: sourceMode, name, normalizedName: name },
        }),
      ),
    );
    const tag = await prisma.eagleManualTag.create({
      data: {
        ownerId,
        libraryMode: sourceMode,
        name: 'Shared',
        normalizedName: 'shared',
        groupId: groups[0].id,
      },
    });
    await prisma.eagleManualTagGroupMembership.createMany({
      data: groups.map((group) => ({
        ownerId,
        libraryMode: sourceMode,
        tagId: tag.id,
        groupId: group.id,
      })),
    });
    await prisma.eagleAssetManualTag.createMany({
      data: rows.map((row) => ({
        ownerId,
        libraryMode: sourceMode,
        assetId: row.id,
        tagId: tag.id,
        assignedByUser: false,
        assignmentProvenance: 'EAGLE_IMPORTED',
      })),
    });
    const storage = new Proxy(
      {},
      { get: () => async () => assert.fail('HANDOFF performed storage I/O') },
    );
    const transfer = new EagleLibraryTransferService(prisma, storage, sourceMode);
    queries = [];
    const results = await transfer.sendBatch(
      ownerId,
      rows.map((row) => ({ input: { operationId: randomUUID(), assetIds: [row.id] } })),
      true,
    );
    assert.ok(results.every((result) => result.status === 'fulfilled'));
    const sendQueries = [...queries];
    const targetTagReads = sendQueries.filter(
      ({ query, params }) =>
        query.includes('SELECT') &&
        query.includes('FROM "public"."EagleManualTag"') &&
        JSON.parse(params).includes(targetMode),
    );
    const assetTagInserts = sendQueries.filter(({ query }) =>
      query.includes('INSERT INTO "public"."EagleAssetManualTag"'),
    );
    assert.equal(assetTagInserts.length, 1);
    const tagInserts = sendQueries.filter(({ query }) =>
      query.includes('INSERT INTO "public"."EagleManualTag"'),
    );
    assert.equal(targetTagReads.length, 2);
    assert.equal(tagInserts.length, 1);
    const maxBinds = Math.max(...sendQueries.map(({ params }) => JSON.parse(params).length));
    assert.ok(maxBinds <= 32767);
    const targetTag = await prisma.eagleManualTag.findFirstOrThrow({
      where: { ownerId, libraryMode: targetMode, normalizedName: 'shared' },
      include: { group: true, groupMemberships: { include: { group: true } }, assetLinks: true },
    });
    assert.equal(targetTag.assetLinks.length, 100);
    assert.ok(
      targetTag.assetLinks.every(
        (link) => !link.assignedByUser && link.assignmentProvenance === 'EAGLE_IMPORTED',
      ),
    );
    assert.equal(targetTag.group.normalizedName, 'primary');
    assert.deepEqual(targetTag.groupMemberships.map(({ group }) => group.normalizedName).sort(), [
      'extra',
      'primary',
    ]);
    assert.equal(
      await prisma.eagleAsset.count({
        where: {
          ownerId,
          libraryMode: sourceMode,
          storageTransferredOut: true,
          transferredAt: { not: null },
        },
      }),
      100,
    );
    console.info(
      JSON.stringify({
        scenario: 'shared-transfer-tags',
        mode: sourceMode,
        targetTagReads: targetTagReads.length,
        tagInsertStatements: tagInserts.length,
        sendStatements: sendQueries.length,
        transactions: sendQueries.filter(({ query }) => query.trim() === 'BEGIN').length,
        assetTagInsertStatements: assetTagInserts.length,
        maxBinds,
        s3: 0,
      }),
    );
  });

test('failed transfer publication rolls back source retirement, target tag creation and journal completion', async () => {
  const ownerId = await owner();
  const source = await prisma.eagleAsset.create({ data: asset(ownerId) });
  const tag = await prisma.eagleManualTag.create({
    data: { ownerId, libraryMode: 'PHOTO', name: 'Rollback', normalizedName: 'rollback' },
  });
  await prisma.eagleAssetManualTag.create({
    data: { ownerId, libraryMode: 'PHOTO', assetId: source.id, tagId: tag.id },
  });
  const operationId = randomUUID();
  const transfer = new EagleLibraryTransferService(prisma, {}, 'PHOTO');
  await assert.rejects(
    transfer.send(ownerId, { operationId, assetIds: [source.id] }, true, undefined, {
      componentIds: [source.id],
      beforePublish: async () => {},
      afterPublish: async () => {
        throw new Error('synthetic-publication-crash');
      },
    }),
    /synthetic-publication-crash/,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
    null,
  );
  assert.equal(await prisma.eagleAsset.count({ where: { ownerId, libraryMode: 'MATERIAL' } }), 0);
  assert.equal(
    await prisma.eagleManualTag.count({ where: { ownerId, libraryMode: 'MATERIAL' } }),
    0,
  );
  assert.equal(
    (await prisma.eagleLibraryTransfer.findUniqueOrThrow({ where: { id: operationId } })).status,
    'PENDING',
  );
  await transfer.send(ownerId, { operationId, assetIds: [source.id] }, true);
  assert.equal(await prisma.eagleAsset.count({ where: { ownerId, libraryMode: 'MATERIAL' } }), 1);
});

for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode} duplicate recovery hosts publish one asset and restart retries durable cleanup`, async () => {
    const ownerId = await owner();
    const session = await prisma.uploadSession.create({
      data: {
        uploaderId: ownerId,
        libraryMode: mode,
        originalName: 'synthetic.jpg',
        mimeType: 'image/jpeg',
        size: 1n,
        objectKey: `users/${ownerId}/uploads/${randomUUID()}`,
        multipartUploadId: randomUUID(),
        status: 'ASSEMBLED',
        eagleState: { create: {} },
        completionParts: [{ partNumber: 1, etag: 'synthetic' }],
      },
    });
    let failDelete = true;
    const storage = {
      headObject: async () => ({ ContentLength: 1 }),
      deleteObject: async () => {
        if (failDelete) throw new Error('synthetic-storage-failure');
      },
    };
    const imports = { finalizeUpload: async () => {}, markUploadFailed: async () => {} };
    // This synthetic fixture cannot discover or modify sessions owned by other test cases.
    const scoped = prisma.$extends({
      query: {
        uploadSession: {
          findMany: ({ args, query }) =>
            query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
          updateMany: ({ args, query }) =>
            query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
        },
        eagleUploadSessionState: {
          findMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
          updateMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
        },
      },
    });
    const create = () =>
      new EagleUploadRecoveryService(
        scoped,
        new EagleUploadService(
          scoped,
          storage,
          new EagleMediaCapabilityService(),
          {
            inspect: async () => ({
              sha256: 'a'.repeat(64),
              format: 'jpeg',
              width: 1,
              height: 1,
              durationMs: null,
            }),
          },
          mode,
        ),
        imports,
        storage,
        mode,
      );
    await Promise.all([
      create().recoverPendingFinalizations(),
      create().recoverPendingFinalizations(),
    ]);
    assert.equal(await prisma.eagleAsset.count({ where: { ownerId, libraryMode: mode } }), 1);
    const done = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(done.status, 'COMPLETED');
    const cleanup = await prisma.uploadSession.create({
      data: {
        uploaderId: ownerId,
        libraryMode: mode,
        originalName: 'failed.jpg',
        mimeType: 'image/jpeg',
        size: 1n,
        objectKey: `users/${ownerId}/uploads/${randomUUID()}`,
        multipartUploadId: randomUUID(),
        status: 'FAILED',
        finalizationAttempts: 10,
      },
    });
    await create().recoverPendingFinalizations();
    assert.equal(
      (await prisma.uploadSession.findUniqueOrThrow({ where: { id: cleanup.id } }))
        .objectCleanupPending,
      true,
    );
    failDelete = false;
    await Promise.all([
      create().recoverPendingFinalizations(),
      create().recoverPendingFinalizations(),
    ]);
    assert.equal(
      (await prisma.uploadSession.findUniqueOrThrow({ where: { id: cleanup.id } }))
        .objectCleanupPending,
      false,
    );
    assert.equal(await prisma.eagleAsset.count({ where: { ownerId, libraryMode: mode } }), 1);
  });

test('replacement cleanup acknowledges only its frozen keys and preserves newer durable intent', async () => {
  const ownerId = await owner();
  const row = await prisma.eagleAsset.create({ data: asset(ownerId) });
  const session = await prisma.uploadSession.create({
    data: {
      uploaderId: ownerId,
      libraryMode: 'PHOTO',
      originalName: 'synthetic.jpg',
      mimeType: 'image/jpeg',
      size: 1n,
      objectKey: `users/${ownerId}/uploads/${randomUUID()}`,
      multipartUploadId: randomUUID(),
      status: 'COMPLETED',
      eagleState: {
        create: { replacementAssetId: row.id, retiredObjectKeys: [`users/${ownerId}/retired-old`] },
      },
    },
  });
  const scoped = prisma.$extends({
    query: {
      uploadSession: {
        findMany: ({ args, query }) =>
          query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
        updateMany: ({ args, query }) =>
          query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
      },
      eagleUploadSessionState: {
        findMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
        updateMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
      },
    },
  });
  const newer = `users/${ownerId}/retired-new`;
  const recovery = new EagleUploadRecoveryService(
    scoped,
    {},
    {},
    {
      deleteObject: async () => {
        await prisma.eagleUploadSessionState.update({
          where: { uploadSessionId: session.id },
          data: { retiredObjectKeys: [newer] },
        });
      },
    },
    'PHOTO',
  );
  await recovery.recoverPendingFinalizations();
  const state = await prisma.eagleUploadSessionState.findUniqueOrThrow({
    where: { uploadSessionId: session.id },
  });
  assert.deepEqual(state.retiredObjectKeys, [newer]);
  assert.equal(state.replacementAssetId, row.id);
});

for (const mode of ['PHOTO', 'MATERIAL'])
  test(`${mode} user operation sends 100 tagged resources through default execution quanta`, async () => {
    const ownerId = await owner(),
      targetMode = mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
    const rows = Array.from({ length: 100 }, () => asset(ownerId, mode));
    await prisma.eagleAsset.createMany({ data: rows });
    const tag = await prisma.eagleManualTag.create({
      data: { ownerId, libraryMode: mode, name: 'Shared', normalizedName: 'shared' },
    });
    await prisma.eagleAssetManualTag.createMany({
      data: rows.map((row) => ({ ownerId, libraryMode: mode, assetId: row.id, tagId: tag.id })),
    });
    const storage = new Proxy(
      {},
      { get: () => async () => assert.fail('HANDOFF operation performed storage I/O') },
    );
    const service = new EagleAssetOperationService(
      prisma,
      new EagleLibraryTransferService(prisma, storage, mode),
      new EagleService(prisma, undefined, mode),
      mode,
    );
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
    queries = [];
    const receipt = await service.enqueue(principal, {
      operationId: randomUUID(),
      kind: 'SEND',
      assetIds: rows.map(({ id }) => id),
    });
    const admission = [...queries];
    queries = [];
    const quanta = Math.ceil(rows.length / OPERATION_SEND_CONCURRENCY);
    for (let index = 0; index < quanta; index++) await service.tick();
    const execution = [...queries];
    const operation = await prisma.eagleAssetOperation.findUniqueOrThrow({
      where: { id: receipt.id },
      include: { items: true },
    });
    assert.equal(operation.items.filter((item) => item.status === 'COMPLETED').length, 100);
    const associations = execution.filter(({ query }) =>
      query.includes('INSERT INTO "public"."EagleAssetManualTag"'),
    );
    assert.equal(associations.length, quanta);
    const targetTagReads = execution.filter(
      ({ query, params }) =>
        query.includes('SELECT') &&
        query.includes('FROM "public"."EagleManualTag"') &&
        JSON.parse(params).includes(targetMode),
    );
    assert.equal(targetTagReads.length, quanta + 1);
    const stats = (events) => ({
      statements: events.length,
      transactions: events.filter(({ query }) => query.trim() === 'BEGIN').length,
    });
    const phases = {
      claim: { statements: 0, transactions: 0 },
      publication: { statements: 0, transactions: 0 },
      outsideTransactions: 0,
    };
    let transaction;
    for (const event of execution) {
      if (event.query.trim() === 'BEGIN') transaction = [];
      if (transaction) transaction.push(event);
      else phases.outsideTransactions++;
      if (event.query.trim() === 'COMMIT' && transaction) {
        const phase = transaction.some(({ query }) =>
          query.includes('INSERT INTO "public"."EagleAsset"'),
        )
          ? phases.publication
          : phases.claim;
        phase.transactions++;
        phase.statements += transaction.length;
        transaction = undefined;
      }
    }

    console.info(
      JSON.stringify({
        scenario: 'operation-transfer-tags',
        mode,
        resources: 100,
        quantum: OPERATION_SEND_CONCURRENCY,
        quanta,
        admission: stats(admission),
        execution: stats(execution),
        phases,
        tagReads: targetTagReads.length,
        associationInserts: associations.length,
        maxBinds: Math.max(
          ...[...admission, ...execution].map(({ params }) => JSON.parse(params).length),
        ),
        s3: 0,
      }),
    );
  });

test('actual operations recovery assembly invalidates PHOTO facts when replacing an original', async () => {
  const ownerId = await owner();
  const original = await prisma.eagleAsset.create({ data: asset(ownerId) });
  await prisma.eaglePhotoMetadata.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      assetId: original.id,
      assetRevision: 1,
      processorVersion: 'synthetic-only',
    },
  });
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#0088cc' } })
    .jpeg()
    .toBuffer();
  const objectKey = `users/${ownerId}/uploads/${randomUUID()}`;
  await prisma.uploadSession.create({
    data: {
      uploaderId: ownerId,
      libraryMode: 'PHOTO',
      originalName: 'replacement.jpg',
      mimeType: 'image/jpeg',
      size: BigInt(bytes.length),
      objectKey,
      multipartUploadId: randomUUID(),
      status: 'ASSEMBLED',
      completionParts: [{ partNumber: 1, etag: 'synthetic' }],
      eagleState: { create: { replacementAssetId: original.id } },
    },
  });
  const scoped = prisma.$extends({
    query: {
      uploadSession: {
        findMany: ({ args, query }) =>
          query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
        updateMany: ({ args, query }) =>
          query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
      },
      eagleUploadSessionState: {
        findMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
        updateMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
      },
    },
  });
  const host = createAssetOperationBackground(scoped, {
    headObject: async () => ({ ContentLength: bytes.length }),
    getObject: async () => ({ Body: Readable.from([bytes]) }),
  });
  // Exercise the real operations provider assembly without starting unrelated maintenance discovery.
  const photoRecovery = Reflect.get(host, 'recoveries')[1];
  await photoRecovery.recoverPendingFinalizations();
  const replaced = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(replaced.mediaRevision, 2);
  assert.equal(replaced.originalObjectKey, objectKey);
  assert.equal(await prisma.eaglePhotoMetadata.count({ where: { assetId: original.id } }), 0);
});

for (const mode of ['MATERIAL', 'PHOTO'])
  test(`${mode} frozen old API timers and new operations safely overlap on upload and maintenance`, async () => {
    const ownerId = await owner();
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#88aa33' },
    })
      .jpeg()
      .toBuffer();
    const objectKey = `users/${ownerId}/uploads/${randomUUID()}`;
    const upload = await prisma.uploadSession.create({
      data: {
        uploaderId: ownerId,
        libraryMode: mode,
        originalName: 'overlap.jpg',
        mimeType: 'image/jpeg',
        size: BigInt(bytes.length),
        objectKey,
        multipartUploadId: randomUUID(),
        status: 'ASSEMBLED',
        completionParts: [{ partNumber: 1, etag: 'synthetic' }],
        eagleState: { create: {} },
      },
    });
    const retained = await prisma.eagleAsset.create({ data: asset(ownerId, mode) });
    const jobs = await Promise.all(
      ['COMPLETED', 'COMPLETED', 'PENDING'].map((status, index) =>
        prisma.eagleAssetProcessingJob.create({
          data: {
            ownerId,
            libraryMode: mode,
            assetId: retained.id,
            kind: 'PURGE_ASSET',
            lane: 'MAINTENANCE',
            assetRevision: 1,
            processorVersion: `overlap-${index}`,
            status,
            ...(status === 'COMPLETED'
              ? { completedAt: new Date(Date.now() - (index === 0 ? 40 : 1) * 86400000) }
              : {}),
          },
        }),
      ),
    );
    const targetMode = mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
    const copyId = randomUUID();
    const copyKey = `users/${ownerId}/assets/${copyId}/original.jpg`;
    const handoffId = randomUUID();
    const transfers = await Promise.all(
      [undefined, 'HANDOFF'].map((storageAction, index) =>
        prisma.eagleLibraryTransfer.create({
          data: {
            id: randomUUID(),
            ownerId,
            sourceMode: mode,
            targetMode,
            sourceIds: [retained.id],
            plan: [
              {
                targetId: index === 0 ? copyId : handoffId,
                targetKey:
                  index === 0 ? copyKey : `users/${ownerId}/assets/${handoffId}/original.jpg`,
                ...(storageAction ? { storageAction } : {}),
              },
            ],
            updatedAt: new Date(Date.now() - 2 * 86400000),
          },
        }),
      ),
    );
    const children = ['legacy', 'current'].map((version) => {
      const child = fork(
        new URL('./background-host-child.mjs', import.meta.url),
        [version, ownerId, mode],
        {
          env: { ...process.env, EAGLE_UPLOAD_RECOVERY_ENABLED: 'true' },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
      const events = [];
      child.on('message', (event) => events.push(event));
      return { child, events, version };
    });
    const wait = async (check) => {
      for (let i = 0; i < 600; i++) {
        assert.ok(
          children.every(
            ({ child, events }) =>
              child.exitCode === null && !events.some((row) => row.event === 'failed'),
          ),
          'a real host child failed',
        );
        if (check()) return;
        await delay(25);
      }
      assert.fail('mixed process hosts did not finish');
    };
    try {
      await wait(() =>
        children.every(({ events }) =>
          ['ready', 'upload-selected', 'sweep-selected'].every((name) =>
            events.some((row) => row.event === name),
          ),
        ),
      );
      const ready = children[0].events.find((row) => row.event === 'ready');
      assert.equal(ready.recoveryInterval, 60000);
      assert.equal(ready.maintenanceInterval, 600000);
      children.forEach(({ child }) => child.send('continue'));
      await wait(() => children.every(({ events }) => events.some((row) => row.event === 'done')));
      assert.equal(
        (await prisma.uploadSession.findUniqueOrThrow({ where: { id: upload.id } })).status,
        'COMPLETED',
      );
      assert.equal(
        await prisma.eagleAsset.count({
          where: { ownerId, libraryMode: mode, originalObjectKey: objectKey },
        }),
        1,
      );
      assert.equal(await prisma.eagleAssetProcessingJob.count({ where: { id: jobs[0].id } }), 0);
      for (const job of jobs.slice(1))
        assert.deepEqual(
          await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: job.id } }),
          job,
        );
      for (const plan of transfers)
        assert.equal(
          (await prisma.eagleLibraryTransfer.findUniqueOrThrow({ where: { id: plan.id } })).status,
          'ABANDONED',
        );
      const deletions = await prisma.eagleObjectDeletion.findMany({ where: { ownerId } });
      assert.equal(
        deletions.length,
        1,
        'overlapping sweeps publish one cleanup intent, never HANDOFF source deletion',
      );
      assert.deepEqual(deletions[0].objectKeys, [copyKey]);
      assert.deepEqual(deletions[0].prefixes, []);
      children.forEach(({ child }) => child.send('repeat'));
      await wait(() =>
        children.every(({ events }) => events.some((row) => row.event === 'repeated')),
      );
      assert.equal(await prisma.eagleObjectDeletion.count({ where: { ownerId } }), 1);
    } finally {
      await Promise.all(
        children.map(async ({ child }) => {
          if (child.exitCode !== null) return;
          if (child.connected) {
            child.send('continue');
            child.send('stop');
          }
          const forced = setTimeout(() => child.kill('SIGKILL'), 5000);
          try {
            await new Promise((resolve) => child.once('exit', resolve));
          } finally {
            clearTimeout(forced);
          }
          assert.equal(child.exitCode, 0, 'both real hosts must drain cleanly');
        }),
      );
    }
  });
