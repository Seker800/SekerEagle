import { setImmediate as flushQueryEvents } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleDuplicateService } from '../../apps/api/dist/eagle/eagle-duplicates.service.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { EagleLibraryTransferService } from '../../apps/api/dist/eagle/eagle-library-transfer.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] }),
  owners = [];
let queries = 0,
  transactions = 0,
  maxAssetReadBindings = 0;
db.$on('query', (event) => {
  queries++;
  if (event.query.startsWith('SELECT') && event.query.includes('FROM "public"."EagleAsset"'))
    maxAssetReadBindings = Math.max(maxAssetReadBindings, JSON.parse(event.params).length);
  if (event.query === 'BEGIN') transactions++;
});
afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.eagleAssetOperation.deleteMany({ where: { ownerId: id } });
    await db.eagleAsset.deleteMany({ where: { ownerId: id } });
    await db.eagleObjectDeletion.deleteMany({ where: { ownerId: id } });
    await db.eagleManualTag.deleteMany({ where: { ownerId: id } });
    await db.user.delete({ where: { id } });
  }
});
after(() => db.$disconnect());
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function fixture(mode) {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  const principal = {
    sub: ownerId,
    authVersion: 0,
    canViewPrivate: false,
    privacyVisibleUntil: null,
    kind: 'browser',
    role: 'USER',
    email: 'test@example.invalid',
    scopes: [],
  };
  const payloads = new Map();
  let reads = 0;
  const storage = {
    getObject: async (key) => {
      reads++;
      assert.ok(payloads.has(key), 'reads only frozen current previews');
      return { Body: Readable.from([payloads.get(key)]) };
    },
  };
  const duplicate = new EagleDuplicateService(db, storage, mode);
  const executor = new EagleAssetOperationService(
    db,
    new EagleLibraryTransferService(db, storage, mode),
    new EagleService(db, undefined, mode),
    mode,
    duplicate,
  );
  const add = async (patch = {}) => {
    const id = randomUUID();
    return db.eagleAsset.create({
      data: {
        id,
        ownerId,
        libraryMode: mode,
        originalName: 'image.jpg',
        displayName: 'image',
        normalizedDisplayName: 'image',
        format: 'jpeg',
        mimeType: 'image/jpeg',
        byteSize: 1000n,
        sha256: hash(id),
        mediaRevision: 1,
        lifecycleStatus: 'READY',
        width: 1200,
        height: 800,
        originalObjectKey: `users/${ownerId}/assets/${id}/original`,
        ...patch,
      },
    });
  };
  const preview = async (asset, bytes) => {
    const key = `users/${ownerId}/assets/${asset.id}/renditions/1/thumbnail.webp`;
    payloads.set(key, bytes);
    await db.eagleAssetRendition.create({
      data: {
        assetId: asset.id,
        ownerId,
        libraryMode: mode,
        kind: 'THUMBNAIL',
        revision: asset.mediaRevision,
        variant: 'default',
        status: 'READY',
        mimeType: 'image/webp',
        byteSize: BigInt(bytes.length),
        storageKey: key,
        width: 96,
        height: 64,
      },
    });
  };
  const original = async (asset, bytes) => {
    payloads.set(asset.originalObjectKey, bytes);
    await db.eagleAsset.update({
      where: { id: asset.id },
      data: {
        sha256: hash(bytes),
        byteSize: BigInt(bytes.length),
        format: 'png',
        mimeType: 'image/png',
      },
    });
  };
  const drain = async (id) => {
    for (let i = 0; i < 1000; i++) {
      await executor.tick();
      const state = (await executor.list(ownerId, true)).find((op) => op.id === id);
      if (!state?.queued && !state?.running) return state;
    }
    throw new Error('executor did not drain');
  };
  return {
    ownerId,
    principal,
    duplicate,
    executor,
    add,
    preview,
    original,
    drain,
    reads: () => reads,
  };
}
for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode}: cleanup batch rejects mixed scope and rolls back on final authorization failure`, async () => {
    const f = await fixture(mode);
    for (let i = 0; i < 2; i++) {
      await f.add({ sha256: hash(`guard-${i}`), rating: 5 });
      await f.add({ sha256: hash(`guard-${i}`), rating: 1 });
    }
    const page = await f.duplicate.list(f.ownerId, false, {});
    const admitted = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      revision: page.exactRevision,
      allExact: true,
    });
    await db.eagleAssetOperationItem.updateMany({
      where: { operationId: admitted.operationId },
      data: { status: 'RUNNING', leaseUntil: new Date(Date.now() + 120000), leaseVersion: 1 },
    });
    const items = await db.eagleAssetOperationItem.findMany({
      where: { operationId: admitted.operationId },
      include: { operation: true },
      orderBy: { ordinal: 'asc' },
    });
    for (const patch of [
      { ownerId: randomUUID() },
      { libraryMode: mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO' },
      { operationId: randomUUID() },
    ]) {
      await assert.rejects(
        f.executor.publishMetadataBatch([items[0], { ...items[1], ...patch }], async (tx) => {
          await f.duplicate.applyCleanupBatch(tx, items);
        }),
        /作用域/,
      );
    }
    await assert.rejects(
      f.executor.publishMetadataBatch(items, async (tx) => {
        await f.duplicate.applyCleanupBatch(tx, items);
        await tx.user.update({ where: { id: f.ownerId }, data: { authVersion: { increment: 1 } } });
      }),
      /AUTH_REQUIRED/,
    );
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.ownerId } })).authVersion, 0);
    assert.equal(
      await db.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
      0,
    );
    assert.equal(
      await db.eagleAssetOperationItem.count({
        where: { operationId: admitted.operationId, status: 'COMPLETED' },
      }),
      0,
    );
    assert.equal(
      await db.eagleAsset.count({ where: { ownerId: f.ownerId, rowVersion: { not: 1 } } }),
      0,
      'keeper metadata and removed resources must roll back together',
    );
  });
  test(`${mode}: multi-group cleanup keeps large resource reads inside the statement budget`, async () => {
    const f = await fixture(mode);
    for (let group = 0; group < 2; group++) {
      const seed = await f.add({ sha256: hash(`wide-${group}`), rating: 5 });
      await db.eagleAsset.createMany({
        data: Array.from({ length: 300 }, () => ({
          ...seed,
          aspectRatio: undefined,
          id: randomUUID(),
          rating: 1,
          originalObjectKey: `users/${f.ownerId}/assets/${randomUUID()}/original`,
        })),
      });
    }
    const page = await f.duplicate.list(f.ownerId, false, {});
    const receipt = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      revision: page.exactRevision,
      allExact: true,
    });
    await flushQueryEvents();
    maxAssetReadBindings = 0;
    await f.executor.tick();
    await flushQueryEvents();
    assert.ok(
      maxAssetReadBindings <= 512,
      `resource read exceeded budget: ${maxAssetReadBindings}`,
    );
    assert.equal((await f.drain(receipt.operationId)).completed, 600);
    assert.equal(
      await db.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
      600,
    );
  });
  test(`${mode}: duplicate cleanup amortizes claims and commits across groups`, async () => {
    const f = await fixture(mode);
    for (let i = 0; i < 40; i++) {
      await f.add({ sha256: hash(`batch-${i}`), rating: 5 });
      await f.add({ sha256: hash(`batch-${i}`), rating: 1 });
    }
    const page = await f.duplicate.list(f.ownerId, false, {});
    const admitted = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      revision: page.exactRevision,
      allExact: true,
    });
    await flushQueryEvents();
    queries = 0;
    transactions = 0;
    const started = performance.now();
    await f.executor.tick();
    await flushQueryEvents();
    const measured = { transactions, queries, elapsedMs: performance.now() - started };
    const state = await db.eagleAssetOperationItem.groupBy({
      by: ['status'],
      where: { operationId: admitted.operationId },
      _count: true,
    });
    assert.equal(
      state.find((row) => row.status === 'COMPLETED')?._count,
      32,
      'one execution turn must process the existing metadata batch, rather than one group',
    );
    assert.equal(state.find((row) => row.status === 'PENDING')?._count, 8);
    assert.equal(measured.transactions, 2, 'one claim and one atomic publication per batch');
    assert.ok(
      measured.queries <= 128,
      `32 groups must stay within the measured SQL budget, observed ${measured.queries}`,
    );
    assert.equal((await f.drain(admitted.operationId)).completed, 40);
    assert.equal(f.reads(), 0);
    console.log(JSON.stringify({ mode, cleanupGroups: 32, ...measured, objectReads: f.reads() }));
  });
  test(`${mode}: one stale duplicate keeper does not fail other groups in its batch`, async () => {
    const f = await fixture(mode),
      keepers = [],
      removed = [];
    for (let i = 0; i < 4; i++) {
      keepers.push(await f.add({ sha256: hash(`isolated-${i}`), rating: 5 }));
      removed.push(await f.add({ sha256: hash(`isolated-${i}`), rating: 1 }));
    }
    const page = await f.duplicate.list(f.ownerId, false, {});
    const admitted = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      revision: page.exactRevision,
      allExact: true,
    });
    await db.eagleAsset.update({
      where: { id: keepers[1].id },
      data: { rowVersion: { increment: 1 } },
    });
    const state = await f.drain(admitted.operationId);
    assert.equal(state.completed, 3);
    assert.equal(state.failed, 1);
    for (let i = 0; i < 4; i++) {
      const row = await db.eagleAsset.findUniqueOrThrow({ where: { id: removed[i].id } });
      assert.equal(!!row.deletedAt, i !== 1);
      assert.equal(
        row.rowVersion,
        removed[i].rowVersion + (i === 1 ? 0 : 1),
        'rolled back batch writes must not be applied twice during conflict isolation',
      );
      assert.equal(
        (await db.eagleAsset.findUniqueOrThrow({ where: { id: keepers[i].id } })).deletedAt,
        null,
      );
    }
    assert.equal(f.reads(), 0);
  });
  test(`${mode}: grouped exact review, ignored decisions, idempotent cleanup, metadata union and restore`, async () => {
    const f = await fixture(mode),
      a = await f.add({ sha256: hash('same'), rating: 1 }),
      b = await f.add({ sha256: hash('same'), rating: 5 });
    const tag = await db.eagleManualTag.create({
      data: { ownerId: f.ownerId, libraryMode: mode, name: '独有标签', normalizedName: 'unique' },
    });
    await db.eagleAssetManualTag.create({
      data: { ownerId: f.ownerId, libraryMode: mode, assetId: a.id, tagId: tag.id },
    });
    let page = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(page.exactGroups, 1);
    assert.equal(page.groups[0].recommendedId, b.id);
    let signature = page.groups[0].signature;
    await f.duplicate.ignore(f.ownerId, false, { signature, ignored: true });
    assert.equal((await f.duplicate.list(f.ownerId, false, {})).totalGroups, 0);
    assert.equal(
      (await f.duplicate.list(f.ownerId, false, { showIgnored: 'true' })).totalGroups,
      1,
    );
    await db.eagleAsset.update({
      where: { id: a.id },
      data: { displayName: 'renamed ignored duplicate', rowVersion: { increment: 1 } },
    });
    const ignoredAfterRename = await f.duplicate.list(f.ownerId, false, { showIgnored: 'true' });
    assert.equal(
      ignoredAfterRename.totalGroups,
      1,
      'metadata edits retain the content-bound ignore decision',
    );
    signature = ignoredAfterRename.groups[0].signature;
    await f.duplicate.ignore(f.ownerId, false, { signature, ignored: false });
    page = await f.duplicate.list(f.ownerId, false, {});
    const input = { operationId: randomUUID(), revision: page.exactRevision, allExact: true };
    const result = await f.duplicate.cleanup(f.principal, input);
    assert.deepEqual(await f.duplicate.cleanup(f.principal, input), result);
    assert.equal(
      (await db.eagleAsset.findUnique({ where: { id: a.id } })).deletedAt,
      null,
      'admission performs no deletion',
    );
    const state = await f.drain(result.operationId);
    assert.equal(state.failed, 0);
    assert.equal(state.completed, 1);
    assert.ok((await db.eagleAsset.findUnique({ where: { id: a.id } })).deletedAt);
    assert.equal((await db.eagleAsset.findUnique({ where: { id: b.id } })).deletedAt, null);
    assert.equal(
      await db.eagleAssetManualTag.count({ where: { assetId: b.id, tagId: tag.id } }),
      1,
    );
    assert.equal(f.reads(), 0, 'exact review and cleanup perform zero object reads');
    const receipts = await f.executor.results(f.principal, result.operationId, {});
    assert.equal(receipts.receipts[0].groupSignature, signature);
    assert.ok(receipts.membership.some((row) => row.id === a.id && row.state === 'TRASH'));
    const restore = await f.executor.undo(f.principal, result.operationId, randomUUID());
    const restored = await f.drain(restore.id);
    assert.equal(restored.failed, 0);
    assert.equal((await db.eagleAsset.findUnique({ where: { id: a.id } })).deletedAt, null);
    assert.equal(
      await db.eagleAssetManualTag.count({ where: { assetId: b.id, tagId: tag.id } }),
      1,
      'undo restores removed resources without losing merged keeper information',
    );
  });
  test(`${mode}: owner, mode, private, trash, stale review and changed keeper cannot be bypassed`, async () => {
    const f = await fixture(mode),
      a = await f.add({ sha256: hash('same') }),
      b = await f.add({ sha256: hash('same') }),
      hidden = await f.add({ sha256: hash('same'), isPrivate: true });
    await f.add({ sha256: hash('same'), libraryMode: mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO' });
    await f.add({ sha256: hash('same'), deletedAt: new Date() });
    const page = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(page.groups[0].count, 2);
    assert.equal(page.coverage.total, 2);
    assert.equal((await f.duplicate.list(randomUUID(), false, {})).totalGroups, 0);
    const group = page.groups[0];
    await assert.rejects(
      f.duplicate.cleanup(f.principal, {
        operationId: randomUUID(),
        groups: [{ signature: group.signature, keepIds: [hidden.id] }],
      }),
    );
    await assert.rejects(
      f.duplicate.cleanup(f.principal, {
        operationId: randomUUID(),
        revision: '0'.repeat(64),
        allExact: true,
      }),
    );
    const keep = group.recommendedId,
      loser = keep === a.id ? b.id : a.id;
    const result = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      groups: [{ signature: group.signature, keepIds: [keep] }],
    });
    await db.eagleAsset.update({
      where: { id: keep },
      data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
    });
    const state = await f.drain(result.operationId);
    assert.equal(state.failed, 1);
    assert.equal(
      (await db.eagleAsset.findUnique({ where: { id: loser } })).deletedAt,
      null,
      'a vanished keeper cannot erase the last copy',
    );
  });
  test(`${mode}: visual indexing persists, resumes without re-reading current previews and invalidates stale groups`, async () => {
    const f = await fixture(mode),
      a = await f.add(),
      b = await f.add({ rating: 5 });
    const pixels = Buffer.alloc(96 * 64 * 3);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 96; x++) {
        const i = (y * 96 + x) * 3;
        pixels[i] = (x * 7 + y * 3) % 256;
        pixels[i + 1] = (x * 3 + y * 7) % 256;
        pixels[i + 2] = x * 2;
      }
    const png = await sharp(pixels, { raw: { width: 96, height: 64, channels: 3 } })
      .png()
      .toBuffer();
    await f.preview(a, png);
    await f.preview(b, png);
    await f.original(a, png);
    await f.original(b, await sharp(png).withMetadata({ density: 144 }).png().toBuffer());
    const scan = await f.duplicate.scan(f.principal, randomUUID());
    assert.equal(f.reads(), 0);
    assert.equal((await f.drain(scan.operationId)).failed, 0);
    assert.equal(f.reads(), 4);
    const page = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(page.coverage.indexed, 2);
    assert.equal(page.similarGroups, 1);
    assert.equal(page.groups[0].recommendedId, b.id);
    const members = await f.duplicate.members(f.ownerId, false, page.groups[0].signature);
    assert.equal(members.items.length, 2);
    assert.ok(members.items.every((row) => !('originalObjectKey' in row)));
    const next = await f.duplicate.scan(f.principal, randomUUID());
    await f.drain(next.operationId);
    assert.equal(f.reads(), 4, 'repeat checks reuse versioned preview and original proofs');
    await db.eagleDuplicateGroup.updateMany({
      where: { ownerId: f.ownerId },
      data: { algorithmVersion: 'legacy' },
    });
    const obsolete = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(obsolete.similarGroups, 0);
    assert.equal(obsolete.outdatedGroups, 1);
    const rebuild = await f.duplicate.scan(f.principal, randomUUID());
    await f.drain(rebuild.operationId);
    assert.equal(f.reads(), 4, 'algorithm-only rebuild reuses all existing current fingerprints');
    const renewed = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(renewed.outdatedGroups, 0);
    assert.equal(renewed.similarGroups, 1);

    await db.eagleAsset.update({
      where: { id: a.id },
      data: { displayName: 'renamed after review', rowVersion: { increment: 1 } },
    });
    const renamed = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(renamed.similarGroups, 1, 'metadata edits must not discard pixel evidence');
    assert.notEqual(
      renamed.groups[0].signature,
      page.groups[0].signature,
      'review still freezes current metadata versions',
    );
    await db.eagleAsset.update({
      where: { id: a.id },
      data: { mediaRevision: { increment: 1 }, rowVersion: { increment: 1 } },
    });
    assert.equal((await f.duplicate.list(f.ownerId, false, {})).similarGroups, 0);
  });
  test(`${mode}: same Live Photo motion is protected even when the still files are identical`, async () => {
    const f = await fixture(mode),
      identifier = randomUUID(),
      a = await f.add({
        sha256: hash('still'),
        livePhotoIdentifier: identifier,
        livePhotoRole: 'STILL',
      }),
      b = await f.add({
        sha256: hash('still'),
        livePhotoIdentifier: identifier,
        livePhotoRole: 'STILL',
      });
    const motion = await f.add({
      mimeType: 'video/quicktime',
      format: 'mov',
      livePhotoIdentifier: identifier,
      livePhotoRole: 'MOTION',
    });
    const page = await f.duplicate.list(f.ownerId, false, {});
    const operation = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      groups: [{ signature: page.groups[0].signature, keepIds: [a.id] }],
    });
    assert.equal((await f.drain(operation.operationId)).failed, 0);
    assert.ok((await db.eagleAsset.findUnique({ where: { id: b.id } })).deletedAt);
    assert.equal((await db.eagleAsset.findUnique({ where: { id: a.id } })).deletedAt, null);
    assert.equal((await db.eagleAsset.findUnique({ where: { id: motion.id } })).deletedAt, null);
  });
  test(`${mode}: private authorization expiry and cancelled scan retain originals`, async () => {
    const f = await fixture(mode),
      a = await f.add({ sha256: hash('private'), isPrivate: true }),
      b = await f.add({ sha256: hash('private'), isPrivate: true });
    const principal = {
      ...f.principal,
      canViewPrivate: true,
      privacyVisibleUntil: new Date(Date.now() + 60_000).toISOString(),
    };
    const page = await f.duplicate.list(f.ownerId, true, {}),
      result = await f.duplicate.cleanup(principal, {
        operationId: randomUUID(),
        groups: [{ signature: page.groups[0].signature, keepIds: [a.id] }],
      });
    await db.eagleAssetOperation.update({
      where: { id: result.operationId },
      data: { privateUntil: new Date(0) },
    });
    assert.equal((await f.drain(result.operationId)).failed, 1);
    assert.equal((await db.eagleAsset.findUnique({ where: { id: b.id } })).deletedAt, null);
    const scan = await f.duplicate.scan(principal, randomUUID());
    await f.executor.cancel(principal, scan.operationId);
    assert.equal((await f.drain(scan.operationId)).cancelled, 3);
    assert.equal(f.reads(), 0);
  });
}
test('60k library read, group pagination beyond the first page, and batch admission query budget', async () => {
  const f = await fixture('MATERIAL');
  for (let offset = 0; offset < 60000; offset += 500) {
    const rows = Array.from({ length: 500 }, (_, i) => {
      const n = offset + i,
        id = randomUUID();
      return {
        id,
        ownerId: f.ownerId,
        libraryMode: 'MATERIAL',
        originalName: `image-${n}.jpg`,
        displayName: `image-${n}`,
        normalizedDisplayName: `image-${n}`,
        format: 'jpeg',
        mimeType: 'image/jpeg',
        byteSize: 1000n,
        sha256: hash(n < 200 ? `pair-${Math.floor(n / 2)}` : `unique-${n}`),
        mediaRevision: 1,
        lifecycleStatus: 'READY',
        width: 1200,
        height: 800,
        originalObjectKey: `users/${f.ownerId}/assets/${id}/original`,
      };
    });
    await db.eagleAsset.createMany({ data: rows });
  }
  await db.$executeRaw`ANALYZE "EagleAsset"`;
  // Prisma query events are delivered asynchronously; exclude the preceding seed/cleanup.
  await flushQueryEvents();
  queries = 0;
  const start = performance.now(),
    page = await f.duplicate.list(f.ownerId, false, {}),
    readMs = performance.now() - start;
  await flushQueryEvents();
  const readQueries = queries;
  assert.equal(page.coverage.total, 60000);
  assert.equal(page.exactGroups, 100);
  assert.equal(page.groups.length, 24);
  assert.ok(readQueries <= 12);

  // Exercise the real composite-relation ceiling on a full, unindexed library.
  const scanStart = performance.now();
  const scan = await f.duplicate.scan(f.principal, randomUUID());
  const scanMs = performance.now() - scanStart;
  const planned = await db.eagleAssetOperationItem.aggregate({
    where: { operationId: scan.operationId },
    _sum: { weight: true },
  });
  assert.equal(planned._sum.weight, 60001);
  await f.executor.cancel(f.principal, scan.operationId);
  // Populate current synthetic evidence to exercise full-library projection too.
  await db.$executeRaw`INSERT INTO "EagleDuplicateFingerprint"
    ("ownerId", "libraryMode", "assetId", "mediaRevision", "processorVersion", hash, colors, contrast, "updatedAt")
    SELECT "ownerId", "libraryMode", id, "mediaRevision", 'preview-dhash-rgb-v1',
      substring(md5(id),1,16), '[]'::jsonb, 0, now()
    FROM "EagleAsset" WHERE "ownerId"=${f.ownerId} AND "libraryMode"='MATERIAL'`;
  await db.$executeRaw`ANALYZE "EagleDuplicateFingerprint"`;
  const indexed = await f.duplicate.scan(f.principal, randomUUID());
  assert.equal(
    (
      await db.eagleAssetOperationItem.aggregate({
        where: { operationId: indexed.operationId },
        _sum: { weight: true },
      })
    )._sum.weight,
    1,
  );
  assert.equal((await f.drain(indexed.operationId)).failed, 0);
  assert.equal(f.reads(), 0);
  console.log(
    JSON.stringify({ library: 60000, scanMs, scanTotal: planned._sum.weight, indexedScanTotal: 1 }),
  );

  let found = page.groups.length,
    next = page.nextCursor;
  while (next) {
    const more = await f.duplicate.list(f.ownerId, false, {
      cursor: next,
      revision: page.revision,
    });
    found += more.groups.length;
    next = more.nextCursor;
  }
  assert.equal(found, 100);
  queries = 0;
  const admitted = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      revision: page.exactRevision,
      allExact: true,
    }),
    admissionQueries = queries;
  assert.ok(
    admissionQueries < 35,
    `100 groups admission must amortize database calls, observed ${admissionQueries}`,
  );
  assert.equal((await f.drain(admitted.operationId)).completed, 100);
  console.log(
    JSON.stringify({
      library: 60000,
      exactGroups: 100,
      readMs,
      readQueries,
      admissionQueries,
      objectReads: f.reads(),
    }),
  );
});

test('failed preview batches retry with a fresh projection, strict idempotency and unsupported entry points', async () => {
  const f = await fixture('MATERIAL'),
    a = await f.add();
  const png = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#3579af' } })
    .png()
    .toBuffer();
  await f.preview(a, png);
  const scan = await f.duplicate.scan(f.principal, randomUUID());
  assert.deepEqual(
    await f.duplicate.scan(f.principal, randomUUID()),
    scan,
    'active checks coalesce',
  );
  process.env.EAGLE_DUPLICATE_PREVIEW_MAX_BYTES = '4';
  try {
    assert.equal((await f.drain(scan.operationId)).failed, 1);
  } finally {
    delete process.env.EAGLE_DUPLICATE_PREVIEW_MAX_BYTES;
  }
  await f.executor.retry(f.principal, scan.operationId);
  assert.equal((await f.drain(scan.operationId)).failed, 0);
  assert.equal((await f.duplicate.list(f.ownerId, false, {})).coverage.indexed, 1);
  assert.equal((await db.eagleAsset.findUnique({ where: { id: a.id } })).deletedAt, null);
  await assert.rejects(
    f.executor.enqueue(f.principal, {
      operationId: randomUUID(),
      kind: 'DUPLICATE_CLEANUP',
      assetIds: [a.id],
    }),
  );
  const page = await f.duplicate.list(f.ownerId, false, {});
  await assert.rejects(f.duplicate.list(f.ownerId, false, { revision: '0'.repeat(64) }));
  await assert.rejects(f.duplicate.list(f.ownerId, false, { cursor: '9999999999999999999999999' }));
  assert.equal(page.totalGroups, 0);
  await assert.rejects(f.duplicate.members(f.ownerId, false, 'a'.repeat(64)));
  await assert.rejects(
    f.duplicate.ignore(f.ownerId, false, { signature: 'a'.repeat(64), ignored: true }),
  );
  const other = await fixture('PHOTO');
  await assert.rejects(other.duplicate.scan(other.principal, scan.operationId));
});

test('a handed-off original retains exactly one active storage owner', async () => {
  const f = await fixture('MATERIAL'),
    source = await f.add();
  await assert.rejects(f.add({ originalObjectKey: source.originalObjectKey }), /Unique constraint/);
  await db.eagleAsset.update({
    where: { id: source.id },
    data: {
      storageTransferredOut: true,
      deletedAt: new Date(),
      purgeAfter: new Date(),
      transferredAt: new Date(),
    },
  });
  const target = await f.add({ libraryMode: 'PHOTO', originalObjectKey: source.originalObjectKey });
  assert.equal(target.originalObjectKey, source.originalObjectKey);
  await assert.rejects(f.add({ originalObjectKey: source.originalObjectKey }), /Unique constraint/);
});

test('one large duplicate group is processed as one review with internal database chunks', async () => {
  const f = await fixture('MATERIAL');
  const rows = Array.from({ length: 1201 }, () => {
    const id = randomUUID();
    return {
      id,
      ownerId: f.ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'copy.jpg',
      displayName: 'copy',
      normalizedDisplayName: 'copy',
      format: 'jpeg',
      mimeType: 'image/jpeg',
      byteSize: 1000n,
      sha256: hash('1201-identical-copies'),
      mediaRevision: 1,
      lifecycleStatus: 'READY',
      originalObjectKey: `users/${f.ownerId}/assets/${id}/original`,
    };
  });
  for (let offset = 0; offset < rows.length; offset += 500)
    await db.eagleAsset.createMany({ data: rows.slice(offset, offset + 500) });
  const page = await f.duplicate.list(f.ownerId, false, {});
  assert.equal(page.groups[0].count, 1201);
  const operation = await f.duplicate.cleanup(f.principal, {
    operationId: randomUUID(),
    allExact: true,
    revision: page.exactRevision,
  });
  const state = await f.drain(operation.operationId);
  assert.equal(state.completed, 1200);
  assert.equal(state.failed, 0);
  assert.equal(await db.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: null } }), 1);
});

test('visual cleanup removes only explicitly unchecked members, including partially viewed groups', async () => {
  const f = await fixture('PHOTO'),
    rows = [await f.add(), await f.add(), await f.add()];
  await db.eagleDuplicateFingerprint.createMany({
    data: rows.map((row) => ({
      assetId: row.id,
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      mediaRevision: 1,
      processorVersion: 'preview-dhash-rgb-v1',
      hash: '0123456789abcdef',
      colors: Array(48).fill(100),
      contrast: 30,
      pixelHash: hash('verified-identical-original-pixels'),
      pixelProcessorVersion: 'oriented-srgb-rgba8-v1',
      pixelStatus: 'VERIFIED',
    })),
  });
  const scan = await f.duplicate.scan(f.principal, randomUUID());
  await f.drain(scan.operationId);
  const page = await f.duplicate.list(f.ownerId, false, {});
  assert.equal(page.similarGroups, 1);
  const operation = await f.duplicate.cleanup(f.principal, {
    operationId: randomUUID(),
    groups: [{ signature: page.groups[0].signature, removeIds: [rows[1].id] }],
  });
  assert.equal((await f.drain(operation.operationId)).failed, 0);
  assert.equal((await db.eagleAsset.findUnique({ where: { id: rows[0].id } })).deletedAt, null);
  assert.equal((await db.eagleAsset.findUnique({ where: { id: rows[2].id } })).deletedAt, null);
  assert.ok((await db.eagleAsset.findUnique({ where: { id: rows[1].id } })).deletedAt);
});

test('backup copies are proven from originals, burst frames are excluded, and all groups clean in one request', async () => {
  const f = await fixture('PHOTO');
  const source = sharp({ create: { width: 96, height: 64, channels: 3, background: '#476a9f' } });
  const preview = await source.clone().png().toBuffer();
  const backups = [];
  for (let i = 0; i < 5; i++) {
    const row = await f.add();
    backups.push(row);
    await f.preview(row, preview);
    await f.original(
      row,
      await source
        .clone()
        .withMetadata({ density: 72 + i })
        .png()
        .toBuffer(),
    );
  }
  const burst = await f.add();
  await f.preview(burst, preview);
  await f.original(
    burst,
    await source
      .clone()
      .composite([
        {
          input: Buffer.from([70, 106, 159]),
          raw: { width: 1, height: 1, channels: 3 },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer(),
  );
  await flushQueryEvents();
  queries = 0;
  transactions = 0;
  const started = performance.now();
  const scan = await f.duplicate.scan(f.principal, randomUUID());
  await flushQueryEvents();
  const admissionSql = queries,
    admissionTransactions = transactions;
  assert.equal((await f.drain(scan.operationId)).failed, 0);
  await flushQueryEvents();
  console.log(
    JSON.stringify({
      case: 'six-originals-five-backups-one-burst',
      admissionSql,
      admissionTransactions,
      scanSqlIncludingClaimsAndProgress: queries,
      scanTransactionsIncludingClaimsAndProgress: transactions,
      s3Gets: f.reads(),
      scanMs: performance.now() - started,
    }),
  );
  const page = await f.duplicate.list(f.ownerId, false, {});
  assert.equal(page.verifiedGroups, 1);
  assert.equal(page.verifiedItems, 4);
  assert.equal(page.originalCheckCompleted, true);
  assert.equal(page.groups[0].count, 5);
  const members = await f.duplicate.members(f.ownerId, false, page.groups[0].signature);
  assert.ok(!members.items.some((row) => row.id === burst.id));
  await assert.rejects(
    f.duplicate.cleanup(f.principal, { operationId: randomUUID(), allVerified: true }),
  );
  await assert.rejects(
    f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      allVerified: true,
      revision: '0'.repeat(64),
    }),
  );
  const operation = await f.duplicate.cleanup(f.principal, {
    operationId: randomUUID(),
    allVerified: true,
    revision: page.revision,
  });
  assert.equal((await f.drain(operation.operationId)).completed, 4);
  assert.equal(await db.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: null } }), 2);
  assert.equal((await db.eagleAsset.findUnique({ where: { id: burst.id } })).deletedAt, null);
});

test('pixel budget skips are visible and retryable after resource configuration changes', async () => {
  const f = await fixture('PHOTO');
  const source = sharp({ create: { width: 96, height: 64, channels: 3, background: '#476a9f' } });
  const preview = await source.clone().png().toBuffer();
  for (let i = 0; i < 2; i++) {
    const row = await f.add();
    await f.preview(row, preview);
    await f.original(
      row,
      await source
        .clone()
        .withMetadata({ density: 72 + i })
        .png()
        .toBuffer(),
    );
  }
  process.env.EAGLE_DUPLICATE_ORIGINAL_MAX_PIXELS = '1';
  try {
    const scan = await f.duplicate.scan(f.principal, randomUUID());
    assert.equal((await f.drain(scan.operationId)).failed, 0);
    const result = await f.duplicate.list(f.ownerId, false, {});
    assert.equal(result.similarGroups, 0);
    assert.equal(result.coverage.unsupportedOriginals, 2);
    const readsBeforeRepeat = f.reads();
    const repeat = await f.duplicate.scan(f.principal, randomUUID());
    assert.equal((await f.drain(repeat.operationId)).failed, 0);
    assert.equal(
      f.reads(),
      readsBeforeRepeat,
      'unchanged pixel budget reuses its exclusion evidence',
    );
  } finally {
    delete process.env.EAGLE_DUPLICATE_ORIGINAL_MAX_PIXELS;
  }
  const next = await f.duplicate.scan(f.principal, randomUUID());
  assert.equal((await f.drain(next.operationId)).failed, 0);
  assert.equal((await f.duplicate.list(f.ownerId, false, {})).similarGroups, 1);
});

test('legacy cleanup request identities remain replayable after the pixel-proof upgrade', async () => {
  const f = await fixture('PHOTO');
  const input = {
    operationId: randomUUID(),
    groups: [{ signature: hash('old-group'), keepIds: [randomUUID()] }],
  };
  await db.eagleAssetOperation.create({
    data: {
      id: input.operationId,
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      kind: 'DUPLICATE_CLEANUP',
      inputIds: [
        hash(JSON.stringify({ allExact: false, revision: undefined, groups: input.groups })),
      ],
      authVersion: 0,
    },
  });
  assert.deepEqual(await f.duplicate.cleanup(f.principal, input), {
    operationId: input.operationId,
    assetIds: [],
  });
});

test('a cancelled scan persists its attempted version without claiming complete coverage', async () => {
  const f = await fixture('PHOTO'),
    row = await f.add();
  await f.preview(
    row,
    await sharp({ create: { width: 96, height: 64, channels: 3, background: '#345678' } })
      .png()
      .toBuffer(),
  );
  assert.equal((await f.duplicate.list(f.ownerId, false, {})).originalCheckAttempted, false);
  const scan = await f.duplicate.scan(f.principal, randomUUID());
  await f.executor.cancel(f.principal, scan.operationId);
  const stopped = await f.duplicate.list(f.ownerId, false, {});
  assert.equal(stopped.originalCheckAttempted, true);
  assert.equal(stopped.originalCheckCompleted, false);
  const declined = await f.duplicate.scan(f.principal, randomUUID(), true);
  assert.deepEqual(declined, { operationId: null, alreadyAttempted: true });
  const resumed = await f.duplicate.scan(f.principal, randomUUID());
  assert.notEqual(resumed.operationId, scan.operationId);
  assert.equal((await f.drain(resumed.operationId)).failed, 0);
  assert.equal((await f.duplicate.list(f.ownerId, false, {})).originalCheckCompleted, true);
});

for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode}: filters cover every member and every page, protect edit parents, and bind bulk keep/cleanup`, async () => {
    const f = await fixture(mode),
      outside = await fixture(mode);
    for (let i = 0; i < 26; i++) {
      const sha256 = hash(`filtered-${i}`);
      for (let j = 0; j < 2; j++)
        await f.add({ sha256, originalName: `same-${i}.jpg`, rating: j + 1 });
    }
    await outside.add({ sha256: hash('foreign'), originalName: 'same.jpg' });
    await outside.add({ sha256: hash('foreign'), originalName: 'same.jpg' });
    const large = hash('large');
    await f.add({ sha256: large, byteSize: 3000n });
    await f.add({ sha256: large, byteSize: 3000n });
    const renamed = hash('renamed');
    await f.add({ sha256: renamed, originalName: 'a.jpg' });
    await f.add({ sha256: renamed, originalName: 'b.jpg' });
    const protectedHash = hash('protected'),
      parent = await f.add({ sha256: protectedHash });
    await f.add({ sha256: protectedHash });
    const edited = await f.add();
    await db.eagleAssetEditRecipe.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: mode,
        assetId: edited.id,
        assetRevision: 1,
        baseAssetId: parent.id,
        baseMediaRevision: 1,
        recipe: {},
      },
    });
    const filters = { sameName: 'true', maxBytes: '2000', protectEdits: 'true', kind: 'EXACT' };
    await flushQueryEvents();
    const listBefore = queries,
      listTransactions = transactions,
      listStart = performance.now();
    const page = await f.duplicate.list(f.ownerId, false, filters);
    await flushQueryEvents();
    console.log(
      JSON.stringify({
        mode,
        filteredGroups: page.totalGroups,
        listSql: queries - listBefore,
        listTransactions: transactions - listTransactions,
        listMs: performance.now() - listStart,
        s3: f.reads(),
      }),
    );
    assert.equal(page.totalGroups, 26);
    const otherKind = await f.duplicate.list(f.ownerId, false, { ...filters, kind: 'SIMILAR' });
    assert.equal(otherKind.totalGroups, 0);
    assert.equal(
      otherKind.exactGroups,
      26,
      'category badges still describe other filtered categories',
    );
    assert.deepEqual(
      await f.duplicate.cleanup(f.principal, {
        operationId: randomUUID(),
        allVerified: true,
        filters: { ...filters, kind: 'SIMILAR' },
        revision: otherKind.revision,
      }),
      { operationId: null },
      'an empty selected category cannot clean another category',
    );
    assert.equal(page.filteredItems, 26);
    assert.equal(page.groups.length, 24);
    const next = await f.duplicate.list(f.ownerId, false, {
      ...filters,
      cursor: page.nextCursor,
      revision: page.revision,
    });
    assert.equal(next.groups.length, 2);
    assert.equal(
      (await f.duplicate.list(f.ownerId, false, { ...filters, sameCapturedAt: 'true' }))
        .totalGroups,
      0,
      'missing EXIF is not equal capture time',
    );
    await assert.rejects(
      f.duplicate.cleanup(f.principal, {
        operationId: randomUUID(),
        allVerified: true,
        revision: page.revision,
        filters: { ...filters, sameName: 'false' },
      }),
      /变化/,
    );
    await assert.rejects(
      f.duplicate.cleanup(outside.principal, {
        operationId: randomUUID(),
        allVerified: true,
        revision: page.revision,
        filters,
      }),
      /变化/,
    );
    await f.duplicate.ignore(f.ownerId, false, {
      allFiltered: true,
      revision: page.revision,
      filters,
      ignored: true,
    });
    assert.equal((await f.duplicate.list(f.ownerId, false, filters)).totalGroups, 0);
    const kept = await f.duplicate.list(f.ownerId, false, { ...filters, showIgnored: 'true' });
    assert.equal(kept.totalGroups, 26);
    await f.duplicate.ignore(f.ownerId, false, {
      allFiltered: true,
      revision: kept.revision,
      filters,
      ignored: false,
    });
    const current = await f.duplicate.list(f.ownerId, false, filters);
    const group = current.groups[0],
      manualKeeper = group.previews.find((a) => a.id !== group.recommendedId).id;
    await assert.rejects(
      f.duplicate.cleanup(f.principal, {
        operationId: randomUUID(),
        allVerified: true,
        revision: current.revision,
        filters,
        keepOverrides: [{ signature: group.signature, keepIds: [edited.id] }],
      }),
      /本组/,
    );
    await flushQueryEvents();
    const admissionBefore = queries,
      admissionTransactions = transactions,
      admissionStart = performance.now();
    const result = await f.duplicate.cleanup(f.principal, {
      operationId: randomUUID(),
      allVerified: true,
      revision: current.revision,
      filters,
      keepOverrides: [{ signature: group.signature, keepIds: [manualKeeper] }],
    });
    await flushQueryEvents();
    console.log(
      JSON.stringify({
        mode,
        cleanupGroups: 26,
        admissionSql: queries - admissionBefore,
        admissionTransactions: transactions - admissionTransactions,
        admissionMs: performance.now() - admissionStart,
        s3: f.reads(),
      }),
    );
    assert.equal((await f.drain(result.operationId)).failed, 0);
    assert.equal(
      await db.eagleAsset.count({ where: { ownerId: f.ownerId, deletedAt: { not: null } } }),
      26,
      'all 26 groups processed, including unloaded page',
    );
    assert.equal((await db.eagleAsset.findUnique({ where: { id: manualKeeper } })).deletedAt, null);
    assert.equal((await db.eagleAsset.findUnique({ where: { id: parent.id } })).deletedAt, null);
    assert.equal(
      await db.eagleAsset.count({ where: { ownerId: outside.ownerId, deletedAt: { not: null } } }),
      0,
    );
    assert.equal(f.reads(), 0, 'filter, batch keep and cleanup use no S3 reads');
  });
}
