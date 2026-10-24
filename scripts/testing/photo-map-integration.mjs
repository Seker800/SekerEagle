import { setTimeout as delay } from 'node:timers/promises';
import { log } from 'node:console';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PhotoMapService } from '../../apps/api/dist/photos/photo-map.service.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const name = `sekereagle-map-test-${randomUUID()}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
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
  prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
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
  const service = new PhotoMapService(prisma);
  const world = { west: -180, east: 180, south: -90, north: 90, zoom: 3 };
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
  assert.equal(cluster.cover.mediaRevision, 1);
  assert.ok(overview.clusters.every((cell) => cell.cover?.libraryMode === 'PHOTO'));
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
  const unlocked = await service.clusters(owner, true, world);
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
  assert.equal(street.level, 20);
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
  const cityGroup = merged.clusters.find((c) => c.count === 27);
  assert.ok(cityGroup);
  assert.ok(Math.abs(cityGroup.photoLatitude - 37.5) < 1e-9);
  assert.ok(Math.abs(cityGroup.photoLongitude - 122.1) < 1e-9);
  log(
    'Real PostgreSQL map counts, privacy/mode/version isolation, membership, pagination, zoom and coordinate edges passed.',
  );
} finally {
  await prisma?.$disconnect();
  if (started) run('docker', ['stop', name]);
}
