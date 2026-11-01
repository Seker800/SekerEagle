import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
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
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  const service = new WorkspaceChangesService(() => listener);
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
    const queuedJob = await db.eagleAssetProcessingJob.create({data:{ownerId,libraryMode:'PHOTO',assetId:asset.id,assetRevision:0,kind:'PROBE_MEDIA',status:'PENDING'}});
    await barrier();
    const beforeClaim = await service.snapshot(ownerId,false);
    await db.eagleAssetProcessingJob.update({where:{id:queuedJob.id},data:{status:'PROCESSING',lockedAt:new Date(),leaseVersion:{increment:1},attempts:{increment:1}}});
    await barrier();
    assert.deepEqual(await service.snapshot(ownerId,false),beforeClaim,'forward claims must keep the existing NOTIFY contention exemption');
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
  } finally {
    await service.onModuleDestroy();
    await db.$disconnect();
  }
});
