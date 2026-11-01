import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { WorkspaceChangesService } from '../../apps/api/dist/workspace-changes.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

test('committed changes are discovered without scanning resources and private writes stay private', async () => {
  const db = new PrismaClient();
  let listener;
  const service = new WorkspaceChangesService(() => {
    listener = new Client({ connectionString: process.env.DATABASE_URL });
    return listener;
  });
  const ownerId = randomUUID(),
    other = randomUUID();
  const barrier = async () => {
    const token = randomUUID();
    const arrived = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('NOTIFY barrier timeout')), 5000);
      const receive = (message) => {
        if (message.payload === token) {
          clearTimeout(timeout);
          listener.off('notification', receive);
          resolve();
        }
      };
      listener.on('notification', receive);
    });
    await db.$executeRaw`SELECT pg_notify('sekereagle_workspace_changes', ${token})`;
    await arrived;
  };
  try {
    await service.onModuleInit();
    for (const id of [ownerId, other])
      await db.user.create({
        data: { id, email: `${id}@example.invalid`, passwordHash: 'synthetic' },
      });
    const initial = await service.snapshot(ownerId, false);
    const asset = await db.eagleAsset.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        isPrivate: true,
        originalName: 'synthetic.jpg',
        displayName: 'synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        originalObjectKey: `users/${ownerId}/synthetic`,
      },
    });
    await barrier();
    assert.deepEqual(await service.snapshot(ownerId, false), initial);
    assert.notDeepEqual(
      await service.snapshot(ownerId, true),
      initial,
      'private owner must discover its own committed changes',
    );
    assert.deepEqual((await service.snapshot(other, true)).scopes, initial.scopes);
    const privateGroup = await db.eaglePhotoGroup.create({
      data: { ownerId, libraryMode: 'PHOTO', kind: 'BURST', sourceKey: randomUUID() },
    });
    await db.eaglePhotoGroupMember.create({
      data: { ownerId, libraryMode: 'PHOTO', groupId: privateGroup.id, assetId: asset.id },
    });
    await db.eaglePhotoGroup.update({ where: { id: privateGroup.id }, data: { title: 'private' } });
    await barrier();
    assert.deepEqual(
      await service.snapshot(ownerId, false),
      initial,
      'private group creation and edits must not wake public observers',
    );
    await db.eaglePhotoAgentTask.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        kind: 'CITY',
        scope: [{ id: asset.id }],
      },
    });
    await barrier();
    assert.deepEqual(await service.snapshot(ownerId, false), initial);
    await db.eagleAsset.update({ where: { id: asset.id }, data: { isPrivate: false } });
    await barrier();
    assert.notEqual(
      (await service.snapshot(ownerId, false)).scopes.PHOTO.ASSETS,
      initial.scopes.PHOTO.ASSETS,
    );
    assert.deepEqual(
      (await service.snapshot(ownerId, false)).scopes.MATERIAL,
      initial.scopes.MATERIAL,
    );
    const beforeTask = await service.snapshot(ownerId, false);
    await db.eaglePhotoAgentTask.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        kind: 'CITY',
        scope: [{ id: asset.id }],
      },
    });
    await barrier();
    assert.notEqual(
      (await service.snapshot(ownerId, false)).scopes.PHOTO.AGENT,
      beforeTask.scopes.PHOTO.AGENT,
      'public requests must be visible before suggestions exist',
    );
    const beforeRollback = await service.snapshot(ownerId, false);
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.eagleAsset.update({
          where: { id: asset.id },
          data: { displayName: 'uncommitted' },
        });
        await barrier();
        assert.deepEqual(await service.snapshot(ownerId, false), beforeRollback);
        throw new Error('intentional rollback');
      }),
      /intentional rollback/,
    );
    await barrier();
    assert.deepEqual(await service.snapshot(ownerId, false), beforeRollback);
    const queuedJob = await db.eagleAssetProcessingJob.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId: asset.id,
        assetRevision: 0,
        kind: 'PROBE_MEDIA',
        status: 'PENDING',
      },
    });
    await barrier();
    const beforeClaim = await service.snapshot(ownerId, false);
    await db.eagleAssetProcessingJob.update({
      where: { id: queuedJob.id },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(),
        leaseVersion: { increment: 1 },
        attempts: { increment: 1 },
      },
    });
    await barrier();
    assert.deepEqual(
      await service.snapshot(ownerId, false),
      beforeClaim,
      'forward claims must keep the existing NOTIFY contention exemption',
    );
    // Lease-only changes cannot wake a display observer forever.
    const job = await db.eagleAssetProcessingJob.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId: asset.id,
        assetRevision: 0,
        kind: 'GENERATE_RENDITIONS',
        status: 'PROCESSING',
      },
    });
    await barrier();
    const beforeLease = await service.snapshot(ownerId, false);
    await db.eagleAssetProcessingJob.update({
      where: { id: job.id },
      data: { lockedAt: new Date(), leaseVersion: { increment: 1 } },
    });
    await barrier();
    assert.deepEqual(await service.snapshot(ownerId, false), beforeLease);
    // A transaction starting first may commit last. Neither commit can be
    // hidden by an ID/timestamp watermark chosen by the faster transaction.
    let staged, commit;
    const ready = new Promise((resolve) => {
      staged = resolve;
    });
    const release = new Promise((resolve) => {
      commit = resolve;
    });
    const slow = db.$transaction(async (tx) => {
      await tx.eagleAsset.create({
        data: {
          ...{
            ownerId,
            libraryMode: 'PHOTO',
            originalName: 'late.jpg',
            displayName: 'late',
            normalizedDisplayName: 'late',
            mimeType: 'image/jpeg',
            format: 'jpeg',
            byteSize: 1,
            originalObjectKey: `users/${ownerId}/late`,
          },
        },
      });
      staged();
      await release;
    });
    await ready;
    await db.eagleAsset.update({ where: { id: asset.id }, data: { displayName: 'fast' } });
    await barrier();
    const fast = await service.snapshot(ownerId, false);
    commit();
    await slow;
    await barrier();
    assert.notEqual(
      (await service.snapshot(ownerId, false)).scopes.PHOTO.ASSETS,
      fast.scopes.PHOTO.ASSETS,
      'late commit must remain discoverable',
    );

    const beforeGap = await service.snapshot(ownerId, false);
    const backend = await listener.query('SELECT pg_backend_pid() AS pid');
    const ended = new Promise((resolve) => listener.once('end', resolve));
    await db.$executeRaw`SELECT pg_terminate_backend(${backend.rows[0].pid}::integer)`;
    await ended;
    await assert.rejects(service.snapshot(ownerId, false), /UNAVAILABLE/);
    await db.eagleAsset.update({ where: { id: asset.id }, data: { displayName: 'during-gap' } });
    let restored;
    for (let n = 0; n < 120; n++) {
      try {
        restored = await service.snapshot(ownerId, false);
        break;
      } catch {
        await delay(25);
      }
    }
    assert.ok(restored, 'listener must recover independently');
    assert.notEqual(
      restored.epoch,
      beforeGap.epoch,
      'new epoch covers commits during disconnection',
    );
  } finally {
    await service.onModuleDestroy();
    await db.$disconnect();
  }
});
