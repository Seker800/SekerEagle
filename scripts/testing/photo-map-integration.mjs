import { setTimeout as delay } from 'node:timers/promises';
import { log } from 'node:console';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { runPhotoMapBuildStep } from '../../apps/worker/dist/photo-map-build.js';
import { PhotoMapService } from '../../apps/api/dist/photos/photo-map.service.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const name = `sekereagle-map-test-${randomUUID()}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
const observedQueries = [];
let started = false,
  prisma;
try {
  run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-p',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql/data:rw',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e',
    'POSTGRES_USER=sekereagle_test',
    '-e',
    'POSTGRES_DB=sekereagle_test',
    'pgvector/pgvector:0.8.6-pg16',
  ]);
  started = true;
  const port = run('docker', ['port', name, '5432']).split(':').at(-1);
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://sekereagle_test@127.0.0.1:${port}/sekereagle_test`,
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'sekereagle-test',
  };
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: env.S3_BUCKET,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      spawnSync('docker', [
        'exec',
        name,
        'pg_isready',
        '-U',
        'sekereagle_test',
        '-d',
        'sekereagle_test',
      ]).status === 0
    )
      break;
    if (attempt === 99) throw new Error('Test database not ready');
    await delay(100);
  }
  run(process.execPath, ['scripts/assert-safe-target.mjs'], { env });
  run(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      'apps/api/prisma/schema.prisma',
    ],
    { env },
  );
  prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: [{ emit: 'event', level: 'query' }],
  });
  prisma.$on('query', (event) => observedQueries.push(event.query));
  const owner = randomUUID(),
    other = randomUUID();
  await prisma.user.createMany({
    data: [owner, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-test-only',
    })),
  });
  const make = async (options = {}, latitude = 30.25, longitude = 120.15, revision = 1) => {
    const id = randomUUID();
    const asset = await prisma.eagleAsset.create({
      data: {
        id,
        ownerId: owner,
        libraryMode: 'PHOTO',
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1n,
        originalObjectKey: `synthetic/${id}`,
        lifecycleStatus: 'READY',
        mediaRevision: 1,
        chronologicalAt: new Date('2024-01-01T00:00:00Z'),
        ...options,
      },
    });
    if (asset.libraryMode === 'PHOTO')
      await prisma.eaglePhotoMetadata.create({
        data: {
          assetId: id,
          ownerId: asset.ownerId,
          libraryMode: asset.libraryMode,
          assetRevision: revision,
          processorVersion: 'test',
          latitude,
          longitude,
        },
      });
    return id;
  };
  const expected = new Set();
  for (let i = 0; i < 130; i++) expected.add(await make());
  const privateId = await make({ isPrivate: true, chronologicalAt: new Date('2099-01-01Z') });
  await make({ libraryMode: 'MATERIAL' });
  await make({ ownerId: other });
  await make({ deletedAt: new Date() });
  await make({}, 30.25, 120.15, 0);
  await assert.rejects(make({}, 30, 181));
  const far = await make({}, -35, -60);
  const supplemental = await make({}, null, null);
  await prisma.eaglePhotoLocation.create({
    data: {
      assetId: supplemental,
      ownerId: owner,
      libraryMode: 'PHOTO',
      assetRevision: 1,
      cityId: 'synthetic-city',
      name: 'City',
      country: 'Test',
      region: 'Test',
      latitude: 30.25,
      longitude: 120.15,
      source: 'MANUAL',
      suggestionId: 'test',
    },
  });
  expected.add(supplemental);
  const stale = await make({}, null, null);
  await prisma.eaglePhotoLocation.create({
    data: {
      assetId: stale,
      ownerId: owner,
      libraryMode: 'PHOTO',
      assetRevision: 0,
      cityId: 'stale',
      name: 'City',
      country: 'Test',
      region: 'Test',
      latitude: 30.25,
      longitude: 120.15,
      source: 'MANUAL',
      suggestionId: 'test',
    },
  });
  const rawService = new PhotoMapService(prisma);
  async function refresh(ownerId = owner) {
    await prisma.eaglePhotoMapState.update({
      where: { ownerId_libraryMode: { ownerId, libraryMode: 'PHOTO' } },
      data: { availableAt: new Date(0) },
    });
    for (let step = 0; step < 100; step++) {
      const state = await prisma.eaglePhotoMapState.findUniqueOrThrow({
        where: { ownerId_libraryMode: { ownerId, libraryMode: 'PHOTO' } },
      });
      if (state.activeSnapshotId && state.builtVersion === state.requestedVersion) return;
      await runPhotoMapBuildStep(prisma);
    }
    throw new Error('Snapshot build did not finish');
  }
  const service = {
    clusters: async (ownerId, privateVisible, view) => {
      await refresh(ownerId);
      return rawService.clusters(ownerId, privateVisible, view);
    },
    photos: (...args) => rawService.photos(...args),
  };
  const world = { west: -180, east: 180, south: -90, north: 90, zoom: 3 };
  const unbuilt = await rawService.clusters(owner, false, world);
  assert.equal(unbuilt.status, 'PENDING');
  // Initial indexing starts before the import quiet period and is independent of media completion.
  for (let i = 0; i < 20; i++) {
    await runPhotoMapBuildStep(prisma);
    const state = await prisma.eaglePhotoMapState.findUniqueOrThrow({
      where: { ownerId_libraryMode: { ownerId: owner, libraryMode: 'PHOTO' } },
    });
    if (state.buildingSnapshotId && state.nextLevel > 0) break;
  }
  const partialOverview = await rawService.clusters(owner, false, world);
  assert.equal(partialOverview.status, 'UPDATING');
  assert.equal(partialOverview.partial, true);
  assert.equal(partialOverview.total, 132);
  assert.equal(partialOverview.level, 3);
  assert.equal(
    partialOverview.clusters.reduce((count, cell) => count + cell.count, 0),
    132,
  );
  assert.ok(
    partialOverview.clusters.every(
      (cell) => !cell.cover || expected.has(cell.cover.id) || cell.cover.id === far,
    ),
  );
  const partialCell = partialOverview.clusters.find((cell) => cell.count === 131);
  assert.ok(partialCell);
  const firstPartialPage = await rawService.photos(owner, false, partialCell.id);
  assert.equal(firstPartialPage.items.length, 60);
  await assert.rejects(rawService.photos(other, false, partialCell.id), /更新/);
  await assert.rejects(
    rawService.photos(owner, false, `${partialOverview.snapshotId}:21/0/0`),
    /更新/,
  );
  const privatePartial = await rawService.clusters(owner, true, world);
  assert.equal(privatePartial.total, 133);
  await refresh(owner);
  assert.equal(
    (await rawService.clusters(owner, false, world)).snapshotId,
    partialOverview.snapshotId,
  );
  const resumed = await rawService.photos(
    owner,
    false,
    partialCell.id,
    firstPartialPage.nextCursor,
  );
  assert.equal(resumed.items.length, 60);
  assert.equal(
    new Set([...firstPartialPage.items, ...resumed.items].map((item) => item.id)).size,
    120,
    'partial member cursors survive completion of finer levels',
  );
  // A committed partial snapshot is revoked immediately by a visibility/location change.
  await prisma.eaglePhotoMetadata.update({ where: { assetId: far }, data: { latitude: -36 } });
  assert.equal((await rawService.clusters(owner, false, world)).status, 'PENDING');
  await assert.rejects(rawService.photos(owner, false, partialCell.id), /更新/);
  const overview = await service.clusters(owner, false, world);
  assert.equal(overview.total, 132);
  assert.equal(
    overview.clusters.reduce((n, c) => n + c.count, 0),
    132,
  );
  const cluster = overview.clusters.find((c) => c.count === 131);
  assert.ok(cluster);
  assert.ok(Math.abs(cluster.photoLatitude - 30.25) < 0.0001);
  assert.ok(Math.abs(cluster.photoLongitude - 120.15) < 0.0001);
  assert.equal(cluster.west, 120.15);
  assert.equal(cluster.east, 120.15);
  assert.ok(expected.has(cluster.cover.id));
  const previews = await rawService.clusters(owner, false, { ...world, zoom: 12 });
  const preview = previews.clusters.find((cell) => cell.count === 131);
  assert.ok(expected.has(preview.cover.id));
  assert.equal(preview.cover.mediaRevision, 1);
  assert.ok(overview.clusters.every((cell) => !cell.cover || cell.cover.libraryMode === 'PHOTO'));
  assert.ok(!overview.clusters.some((cell) => cell.cover?.id === privateId));
  const seen = [],
    cursors = [];
  let cursor;
  do {
    const result = await service.photos(owner, false, cluster.id, cursor);
    assert.ok(result.items.length <= 60);
    seen.push(...result.items.map((a) => a.id));
    cursor = result.nextCursor ?? undefined;
    if (cursor) cursors.push(cursor);
  } while (cursor);
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual(new Set(seen), expected);
  assert.ok(!seen.includes(far));
  assert.equal(cursors.length, 2);
  await assert.rejects(service.photos(other, false, cluster.id, cursors[0]));
  await assert.rejects(service.photos(owner, true, cluster.id, cursors[0]));
  const unlocked = await service.clusters(owner, true, { ...world, zoom: 12 });
  assert.equal(unlocked.total, 133);
  assert.ok(unlocked.clusters.some((cell) => cell.cover?.id === privateId));
  const detail = await service.clusters(owner, false, {
    west: 120.1,
    east: 120.2,
    south: 30.2,
    north: 30.3,
    zoom: 12,
  });
  assert.equal(detail.total, 132);
  assert.equal(
    detail.clusters.reduce((n, c) => n + c.count, 0),
    131,
  );
  assert.ok(detail.level > overview.level);
  const preciseMembers = await service.photos(owner, false, detail.clusters[0].id);
  assert.equal(preciseMembers.items.length, 60);
  const street = await service.clusters(owner, false, {
    west: 120.149,
    east: 120.151,
    south: 30.249,
    north: 30.251,
    zoom: 16,
  });
  assert.equal(street.level, 21);
  assert.equal(
    street.clusters.reduce((sum, cell) => sum + cell.count, 0),
    131,
  );
  assert.equal((await service.photos(owner, false, street.clusters[0].id)).items.length, 60);
  const pole = await make({}, 90, 180);
  const poles = await service.clusters(owner, false, world);
  assert.ok(
    poles.clusters.every((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude)),
  );
  const poleCluster = poles.clusters.find((c) => c.id.endsWith(`/${2 ** poles.level - 1}/0`));
  assert.equal((await service.photos(owner, false, poleCluster.id)).items[0].id, pole);
  await prisma.eagleAsset.deleteMany({ where: { id: { in: [...expected] } } });
  assert.equal((await service.clusters(owner, false, world)).total, 2);
  for (let i = 0; i < 20; i++) await make({}, 37.5, 122.1);
  for (let i = 0; i < 7; i++) await make({}, 39.9, 116.4);
  const merged = await service.clusters(owner, false, { ...world, zoom: 1 });
  const weihai = merged.clusters.find((c) => Math.abs(c.photoLatitude - 37.5) < 1e-9);
  const beijing = merged.clusters.find((c) => Math.abs(c.photoLatitude - 39.9) < 1e-9);
  assert.equal(weihai.count, 20);
  assert.equal(beijing.count, 7);
  assert.notEqual(weihai.id, beijing.id);
  // More than the old 1,024-grid budget remain independently visible in one wide view.
  const denseOwner = randomUUID();
  await prisma.user.create({
    data: {
      id: denseOwner,
      email: `${denseOwner}@example.invalid`,
      passwordHash: 'synthetic-test-only',
    },
  });
  const denseIds = Array.from({ length: 1500 }, () => randomUUID());
  await prisma.eagleAsset.createMany({
    data: denseIds.map((id) => ({
      id,
      ownerId: denseOwner,
      libraryMode: 'PHOTO',
      originalName: 'synthetic.jpg',
      displayName: 'Synthetic distribution',
      normalizedDisplayName: 'synthetic distribution',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1n,
      originalObjectKey: `synthetic/${id}`,
      lifecycleStatus: 'READY',
      mediaRevision: 1,
    })),
  });
  await prisma.eaglePhotoMetadata.createMany({
    data: denseIds.map((assetId, i) => ({
      assetId,
      ownerId: denseOwner,
      libraryMode: 'PHOTO',
      assetRevision: 1,
      processorVersion: 'test',
      latitude: -50 + Math.floor(i / 50) * 3,
      longitude: -170 + (i % 50) * 6.5,
    })),
  });
  await refresh(denseOwner);
  const densityStart = performance.now();
  const distribution = await rawService.clusters(denseOwner, false, world);
  const densityMs = performance.now() - densityStart;
  assert.ok(densityMs < 5000, `Dense distribution query took ${densityMs} ms`);
  log(`1,500 independent locations returned in ${Math.round(densityMs)} ms.`);
  assert.equal(distribution.total, 1500);
  assert.equal(distribution.clusters.length, 1500);
  assert.equal(
    distribution.clusters.reduce((sum, c) => sum + c.count, 0),
    1500,
  );
  assert.equal(distribution.clusters.filter((c) => c.cover).length, 9);
  const detailCovers = await rawService.clusters(denseOwner, false, { ...world, zoom: 12 });
  assert.equal(detailCovers.clusters.filter((c) => c.cover).length, 9);
  assert.equal(
    (await service.photos(denseOwner, false, distribution.clusters[1000].id)).items.length,
    1,
  );

  observedQueries.length = 0;
  await rawService.clusters(denseOwner, false, world);
  assert.ok(
    observedQueries.every(
      (sql) =>
        !sql.includes('EaglePhotoMetadata') &&
        !sql.includes('EaglePhotoLocation') &&
        !/GROUP BY|INSERT|UPDATE/.test(sql),
    ),
  );
  const old = await rawService.clusters(owner, false, world);
  const added = await make({}, 42, 110);
  const deferred = await rawService.clusters(owner, false, world);
  assert.equal(deferred.total, old.total);
  assert.equal(deferred.status, 'UPDATING');
  assert.equal(deferred.snapshotId, old.snapshotId);
  const stateKey = { ownerId_libraryMode: { ownerId: owner, libraryMode: 'PHOTO' } };
  await prisma.eaglePhotoMapState.update({ where: stateKey, data: { availableAt: new Date(0) } });
  await runPhotoMapBuildStep(prisma); // fixed points prepared, no partial generation is public
  assert.equal((await rawService.clusters(owner, false, world)).snapshotId, old.snapshotId);
  await refresh(owner);
  const fresh = await rawService.clusters(owner, false, world);
  assert.equal(fresh.total, old.total + 1);
  assert.notEqual(fresh.snapshotId, old.snapshotId);
  await prisma.eagleAsset.update({ where: { id: added }, data: { isPrivate: true } });
  const hidden = await rawService.clusters(owner, false, world);
  assert.equal(hidden.status, 'PENDING');
  assert.equal(hidden.total, 0);
  assert.equal(hidden.clusters.length, 0);
  await assert.rejects(rawService.photos(owner, false, fresh.clusters[0].id));
  await refresh(owner);
  assert.equal((await rawService.clusters(owner, false, world)).total, old.total);
  assert.equal((await rawService.clusters(owner, true, world)).total, old.total + 2);
  const busy = await prisma.eagleAssetProcessingJob.create({
    data: {
      ownerId: owner,
      libraryMode: 'PHOTO',
      assetId: added,
      assetRevision: 1,
      kind: 'GENERATE_RENDITIONS',
      lane: 'INTERACTIVE',
      status: 'PENDING',
      availableAt: new Date(0),
    },
  });
  await prisma.eaglePhotoMetadata.update({ where: { assetId: added }, data: { latitude: 43 } });
  await prisma.eaglePhotoMapState.update({ where: stateKey, data: { availableAt: new Date(0) } });
  await prisma.eagleAssetProcessingJob.update({
    where: { id: busy.id },
    data: { status: 'PROCESSING', lockedAt: new Date() },
  });
  await runPhotoMapBuildStep(prisma);
  assert.ok(
    (await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey })).buildingSnapshotId,
    'Remote/other media PROCESSING does not block the bounded map step under the scheduler budget',
  );
  await prisma.eagleAssetProcessingJob.update({
    where: { id: busy.id },
    data: { status: 'PENDING', lockedAt: null },
  });
  await runPhotoMapBuildStep(prisma);
  assert.ok(
    (await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey })).buildingSnapshotId,
    'Pending ingestion must not starve a bounded map step between media jobs',
  );
  await prisma.eagleAssetProcessingJob.update({
    where: { id: busy.id },
    data: { status: 'COMPLETED' },
  });
  await refresh(owner);
  // Bounded coalescing: continuous arrivals cannot postpone the next idle rebuild forever.
  await prisma.eaglePhotoMapState.update({
    where: stateKey,
    data: { dirtyAt: new Date(Date.now() - 11 * 60000) },
  });
  await prisma.eagleAsset.update({
    where: { id: added },
    data: { chronologicalAt: new Date('2025-01-01Z') },
  });
  assert.ok(
    (
      await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey })
    ).availableAt.getTime() <= Date.now(),
  );
  await refresh(owner);
  // A sensitive change during a multi-step build discards that generation.
  await make({}, 41, 111);
  await prisma.eaglePhotoMapState.update({ where: stateKey, data: { availableAt: new Date(0) } });
  await runPhotoMapBuildStep(prisma);
  const interrupted = (await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey }))
    .buildingSnapshotId;
  assert.ok(interrupted);
  await runPhotoMapBuildStep(prisma);
  const partialSnapshot = await prisma.eaglePhotoMapSnapshot.findUniqueOrThrow({
    where: { id: interrupted },
  });
  assert.equal(partialSnapshot.completedAt, null);
  const partialState = await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey });
  assert.ok(partialState.nextLevel > 0 && partialState.nextLevel < 22);
  const livePartialCell = await prisma.eaglePhotoMapCell.findFirstOrThrow({
    where: { snapshotId: interrupted, includePrivate: false, level: 3 },
  });
  const livePartialKey = `${interrupted}:${livePartialCell.level}/${livePartialCell.x}/${livePartialCell.y}`;
  assert.ok((await rawService.photos(owner, false, livePartialKey)).items.length > 0);

  await prisma.eaglePhotoMetadata.update({ where: { assetId: added }, data: { latitude: 44 } });
  await assert.rejects(rawService.photos(owner, false, livePartialKey), /更新/);

  await runPhotoMapBuildStep(prisma);
  assert.equal(await prisma.eaglePhotoMapSnapshot.count({ where: { id: interrupted } }), 0);
  assert.equal((await rawService.clusters(owner, false, world)).status, 'PENDING');
  await refresh(owner);
  await refresh(other);
  // A mid-step failure rolls back all levels from that step, keeps the old map, and retries safely.
  const prior = (await rawService.clusters(owner, false, world)).snapshotId;
  await make({}, 40, 112);
  await prisma.eaglePhotoMapState.update({ where: stateKey, data: { availableAt: new Date(0) } });
  await runPhotoMapBuildStep(prisma);
  const partial = (await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey }))
    .buildingSnapshotId;
  await prisma.$executeRaw`CREATE FUNCTION map_index_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.level=1 THEN RAISE EXCEPTION 'synthetic map build interruption'; END IF; RETURN NEW; END; $$`;
  await prisma.$executeRaw`CREATE TRIGGER map_index_test_fault BEFORE INSERT ON "EaglePhotoMapCell" FOR EACH ROW EXECUTE FUNCTION map_index_test_fault()`;
  await assert.rejects(runPhotoMapBuildStep(prisma), /synthetic map build interruption/);
  assert.equal(await prisma.eaglePhotoMapCell.count({ where: { snapshotId: partial } }), 0);
  assert.equal((await rawService.clusters(owner, false, world)).snapshotId, prior);
  assert.equal(
    (await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: stateKey })).attempts,
    1,
  );
  await prisma.$executeRaw`DROP TRIGGER map_index_test_fault ON "EaglePhotoMapCell"`;
  await prisma.$executeRaw`DROP FUNCTION map_index_test_fault()`;
  await refresh(owner);

  // New facts may invalidate visibility but must not erase a real retry deadline.
  const retryOwner = randomUUID();
  await prisma.user.create({ data: { id: retryOwner, email: `${retryOwner}@example.invalid`, passwordHash: 'test-only' } });
  const retryPhoto = await make({ ownerId: retryOwner });
  const retryKey = { ownerId_libraryMode: { ownerId: retryOwner, libraryMode: 'PHOTO' } };
  const retryAt = new Date(Date.now() + 600000);
  await prisma.eaglePhotoMapState.update({ where: retryKey, data: { attempts: 3, lastError: 'INDEX_BUILD_FAILED', availableAt: retryAt } });
  await make({ ownerId: retryOwner });
  let retryState = await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: retryKey });
  assert.equal(retryState.lastError, 'INDEX_BUILD_FAILED', 'arriving photos must not erase failure backoff');
  assert.equal(retryState.attempts, 3);
  assert.equal(retryState.availableAt.getTime(), retryAt.getTime());
  assert.equal(await runPhotoMapBuildStep(prisma), false, 'first-build bypass cannot skip an established retry deadline');
  const visibilityBefore = retryState.visibilityVersion;
  await prisma.eagleAsset.update({ where: { id: retryPhoto }, data: { isPrivate: true } });
  await prisma.eaglePhotoMetadata.update({ where: { assetId: retryPhoto }, data: { longitude: 122 } });
  retryState = await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: retryKey });
  assert.ok(retryState.visibilityVersion > visibilityBefore, 'sensitive changes still revoke old generations');
  assert.equal(retryState.attempts, 3);
  assert.equal(retryState.lastError, 'INDEX_BUILD_FAILED');
  assert.equal(retryState.availableAt.getTime(), retryAt.getTime());
  await prisma.eaglePhotoMapState.update({ where: retryKey, data: { availableAt: new Date(0) } });
  await runPhotoMapBuildStep(prisma);
  retryState = await prisma.eaglePhotoMapState.findUniqueOrThrow({ where: retryKey });
  assert.equal(retryState.lastError, null);
  assert.equal(retryState.attempts, 0, 'a successful point-freeze resets the failure budget');
  await refresh(retryOwner);
  if (process.env.PHOTO_MAP_SCALE_TEST === '1') {
    const scaleOwner = randomUUID(),
      scaleIds = Array.from({ length: 50000 }, () => randomUUID());
    await prisma.user.create({
      data: {
        id: scaleOwner,
        email: `${scaleOwner}@example.invalid`,
        passwordHash: 'synthetic-scale-only',
      },
    });
    for (let offset = 0; offset < scaleIds.length; offset += 500) {
      const batch = scaleIds.slice(offset, offset + 500);
      await prisma.eagleAsset.createMany({
        data: batch.map((id) => ({
          id,
          ownerId: scaleOwner,
          libraryMode: 'PHOTO',
          originalName: 'synthetic.jpg',
          displayName: 'Synthetic scale point',
          normalizedDisplayName: 'synthetic scale point',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1n,
          originalObjectKey: `synthetic/${id}`,
          lifecycleStatus: 'READY',
          mediaRevision: 1,
        })),
      });
      await prisma.eaglePhotoMetadata.createMany({
        data: batch.map((assetId, i) => ({
          assetId,
          ownerId: scaleOwner,
          libraryMode: 'PHOTO',
          assetRevision: 1,
          processorVersion: 'test',
          latitude: 25 + Math.floor(((offset + i) % 40) / 10) * 5,
          longitude: 90 + ((offset + i) % 10) * 7,
        })),
      });
    }
    const started = performance.now();
    await refresh(scaleOwner);
    const buildMs = performance.now() - started;
    const readStart = performance.now();
    for (let i = 0; i < 10; i++)
      assert.equal((await rawService.clusters(scaleOwner, false, world)).total, 50000);
    const readMs = (performance.now() - readStart) / 10;
    log(
      `50,000 synthetic photos indexed in ${Math.round(buildMs)} ms; cached map read average ${Math.round(readMs)} ms.`,
    );
  }
  log(
    'Real PostgreSQL map counts, privacy/mode/version isolation, membership, pagination, zoom and coordinate edges passed.',
  );
} finally {
  await prisma?.$disconnect();
  if (started) run('docker', ['stop', name]);
}
