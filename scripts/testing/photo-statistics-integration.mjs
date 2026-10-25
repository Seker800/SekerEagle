import { setTimeout as delay } from 'node:timers/promises';
import { log } from 'node:console';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PhotoStatisticsService } from '../../apps/api/dist/photos/photo-statistics.service.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const name = `sekereagle-statistics-test-${randomUUID()}`;
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
  const make = async (options = {}, metadata = {}) => {
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
        ...options,
      },
    });
    if (asset.libraryMode === 'PHOTO')
      await prisma.eaglePhotoMetadata.create({
        data: {
          assetId: id,
          ownerId: asset.ownerId,
          libraryMode: asset.libraryMode,
          assetRevision: 1,
          processorVersion: 'test',
          capturedAt: new Date('2024-01-31T20:00:00Z'),
          capturedLocal: '2024-02-01T04:00:00',
          cameraModel: 'A',
          lensModel: 'L1',
          ...metadata,
        },
      });
    return id;
  };
  await make();
  await make({}, { lensModel: 'L2', capturedLocal: '2024-04-01T04:00:00' });
  await make({}, { cameraModel: 'B', capturedAt: null, capturedLocal: null });
  await make({}, { cameraModel: null, lensModel: null, capturedAt: null });
  await make({ isPrivate: true });
  await make({ ownerId: other });
  await make({ libraryMode: 'MATERIAL' });
  await make({ deletedAt: new Date() });
  await make({ mimeType: 'video/mp4' });
  await make({}, { assetRevision: 0, cameraModel: 'Stale' });
  const service = new PhotoStatisticsService(prisma);
  const data = await service.get(owner, false, { grain: 'month', groupBy: 'total' });
  assert.equal(data.total, 5);
  assert.equal(data.groupBy, 'total');
  assert.ok(data.points.every((point) => point.key === ''));
  assert.equal(
    data.points.reduce((n, point) => n + point.count, 0),
    data.total - data.unknownDate,
  );
  assert.equal(data.unknownDate, 3);
  assert.deepEqual(data.periods, ['2024-02', '2024-03', '2024-04']);
  assert.deepEqual(
    data.points.map((p) => p.period),
    ['2024-02', '2024-04'],
  );
  const defaults = await service.get(owner, false, {});
  assert.equal(defaults.grain, 'month');
  assert.equal(defaults.groupBy, 'camera');
  const weekly = await service.get(owner, false, { grain: 'week' });
  assert.equal(weekly.grain, 'week');
  assert.equal(weekly.groupBy, 'camera');
  assert.equal(weekly.periods[0], '2024-01-29');
  assert.equal(weekly.periods.at(-1), '2024-04-01');
  assert.deepEqual(
    weekly.points.map((point) => point.period),
    ['2024-01-29', '2024-04-01'],
  );
  assert.ok(weekly.points.every((point) => point.key === 'A'));
  assert.equal(
    weekly.points.reduce((sum, point) => sum + point.count, 0),
    2,
  );
  const boundary = await make(
    {},
    { capturedAt: new Date('2025-01-01T12:00:00Z'), capturedLocal: '2025-01-01T20:00:00' },
  );
  const sunday = await make(
    {},
    { capturedAt: new Date('2024-12-29T12:00:00Z'), capturedLocal: '2024-12-29T20:00:00' },
  );
  const nextSunday = await make(
    {},
    { capturedAt: new Date('2025-01-05T12:00:00Z'), capturedLocal: '2025-01-05T20:00:00' },
  );
  const crossYear = await service.get(owner, false, {
    start: '2024-12-29',
    end: '2025-01-05',
    grain: 'week',
  });
  assert.deepEqual(
    crossYear.points.map((point) => [point.period, point.count]),
    [
      ['2024-12-23', 1],
      ['2024-12-30', 2],
    ],
  );
  const partialWeek = await service.get(owner, false, {
    start: '2025-01-01',
    end: '2025-01-01',
    grain: 'week',
  });
  assert.equal(partialWeek.points[0].count, 1);
  assert.equal(partialWeek.points[0].period, '2024-12-30');
  await prisma.eagleAsset.deleteMany({
    where: { ownerId: owner, id: { in: [boundary, sunday, nextSunday] } },
  });
  assert.ok(!data.cameraOptions.includes('Stale'));
  assert.equal(
    data.cameras.reduce((n, x) => n + x.count, 0),
    data.total,
  );
  assert.equal((await service.get(owner, true, {})).total, 6);
  assert.equal((await service.get(other, false, {})).total, 1);
  assert.equal((await service.get(owner, false, { cameras: ['A'], lenses: ['L2'] })).total, 1);
  assert.equal((await service.get(owner, false, { cameras: ['A', 'B'], lenses: ['L1'] })).total, 2);
  assert.equal((await service.get(owner, false, { cameras: [''] })).total, 2);
  const range = await service.get(owner, false, {
    start: '2024-02-01',
    end: '2024-02-29',
    grain: 'day',
  });
  assert.equal(range.total, 1);
  assert.equal(range.periods.length, 29);
  assert.equal(range.unknownDate, 0);
  assert.equal((await service.get(owner, false, { start: '2024-05-01' })).total, 0);
  assert.equal((await service.get(owner, false, { cameras: ["A' OR true --"] })).total, 0);
  for (let i = 0; i < 25; i++) await make({}, { cameraModel: `Device ${i}` });
  const crowded = await service.get(owner, false, { groupBy: 'camera' });
  assert.equal(new Set(crowded.points.map((p) => p.key)).size, 24);
  assert.ok(crowded.points.some((p) => p.key === null));
  assert.equal(
    crowded.points.reduce((n, x) => n + x.count, 0),
    crowded.total - crowded.unknownDate,
  );
  assert.ok(crowded.cameras.length > 24);
  await assert.rejects(service.get(owner, false, { grain: 'day', start: '2000-01-01' }));
  assert.equal((await service.get(owner, false, { groupBy: 'lens' })).points[0].key, 'L1');
  const beforeBulk = (await service.get(owner, false, {})).total;
  for (let i = 0; i < 130; i++) await make();
  assert.equal((await service.get(owner, false, {})).total, beforeBulk + 130);
  const lensOwner = randomUUID();
  await prisma.user.create({
    data: {
      id: lensOwner,
      email: `${lensOwner}@example.invalid`,
      passwordHash: 'synthetic-test-only',
    },
  });
  for (const metadata of [
    { cameraModel: ' Phone A ', lensModel: null },
    { cameraModel: 'Phone A', lensModel: '   ' },
    { cameraModel: 'Phone B', lensModel: null },
    { cameraModel: 'Camera C', lensModel: 'Phone A' },
    { cameraModel: null, cameraMake: 'Maker Only', lensModel: null },
    { cameraModel: null, cameraMake: null, lensModel: null },
    { cameraModel: 'Camera C', lensModel: '["camera","Phone A"]' },
  ])
    await make({ ownerId: lensOwner }, metadata);
  await make(
    { ownerId: lensOwner, isPrivate: true },
    { cameraModel: 'Private Phone', lensModel: null },
  );
  await make(
    { ownerId: lensOwner },
    { assetRevision: 0, cameraModel: 'Stale Phone', lensModel: null },
  );
  const key = (kind, name) => JSON.stringify([kind, name]);
  const lensData = await service.get(lensOwner, false, { groupBy: 'lens' });
  assert.equal(lensData.total, 8);
  assert.equal(lensData.lenses.find((x) => x.key === key('camera', 'Phone A'))?.count, 2);
  assert.equal(lensData.lenses.find((x) => x.key === key('lens', 'Phone A'))?.count, 1);
  assert.equal(lensData.lenses.find((x) => x.key === key('camera', 'Maker Only'))?.count, 1);
  assert.equal(lensData.lenses.find((x) => x.key === key('unknown', ''))?.count, 2);
  assert.equal(
    lensData.lenses.reduce((n, x) => n + x.count, 0),
    lensData.total,
  );
  assert.ok(!lensData.lensOptions.includes(key('camera', 'Private Phone')));
  assert.ok(!lensData.lensOptions.includes(key('camera', 'Stale Phone')));
  const selected = await service.get(lensOwner, false, {
    groupBy: 'lens',
    lensKeys: [key('camera', 'Phone A')],
  });
  assert.equal(selected.total, 2);
  assert.ok(selected.points.every((x) => x.key === key('camera', 'Phone A')));
  assert.equal(
    (await service.get(lensOwner, false, { lensKeys: [key('camera', 'Private Phone')] })).total,
    0,
  );
  assert.equal(
    (await service.get(lensOwner, true, { lensKeys: [key('camera', 'Private Phone')] })).total,
    1,
  );
  assert.equal((await service.get(lensOwner, false, { lenses: ['Phone A'] })).total, 1);
  assert.equal(
    (await service.get(lensOwner, false, { lenses: [key('camera', 'Phone A')] })).total,
    1,
  );
  assert.equal(
    (await service.get(lensOwner, false, { lensKeys: [key('camera', "Phone A' OR true --")] }))
      .total,
    0,
  );
  assert.equal(
    (
      await service.get(lensOwner, false, {
        cameras: ['Phone B'],
        lensKeys: [key('camera', 'Phone A')],
      })
    ).total,
    0,
  );
  log(
    'Photo statistics PostgreSQL integration passed: full counts, device intersections, local dates, calendar gaps, private/owner/mode/version isolation, unknown fields and bounded series.',
  );
} finally {
  await prisma?.$disconnect();
  if (started) run('docker', ['stop', name]);
}
