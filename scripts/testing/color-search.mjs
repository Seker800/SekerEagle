import { observePrismaAdapter } from './database-query-probe.mjs';
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import {
  extractSearchColors,
  paletteColorScore,
  hexColorLab,
  deltaE2000,
  COLOR_PALETTE_VERSION,
} from '../../packages/library-core/dist/index.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { colorScoreSql, deltaE2000Sql } from '../../apps/api/dist/eagle/eagle-color-sql.js';

const name = `sekereagle-color-test-${randomUUID()}`;
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw Error(`${cmd}: ${result.stderr}\n${result.stdout}`);
  return (result.stdout ?? '').trim();
}
let started = false,
  db,
  measuring = false,
  sqlCount = 0;
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
  run(process.execPath, ['scripts/assert-safe-target.mjs'], { env });
  for (let i = 0; i < 100; i++) {
    const p = spawnSync('docker', [
      'exec',
      name,
      'pg_isready',
      '-U',
      'sekereagle_test',
      '-d',
      'sekereagle_test',
    ]);
    if (p.status === 0) break;
    if (i === 99) throw Error('Isolated database not ready');
  }
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
  db = new PrismaClient({
    adapter: observePrismaAdapter(() => {
      if (measuring) sqlCount++;
    }),
    datasourceUrl: env.DATABASE_URL,
    log: [{ emit: 'event', level: 'query' }],
  });

  let seed = 123456;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pairs = Array.from({ length: 100 }, () => [
    [random() * 100, random() * 250 - 125, random() * 250 - 125],
    [random() * 100, random() * 250 - 125, random() * 250 - 125],
  ]);
  for (const [a, b] of pairs) {
    const sql = deltaE2000Sql(
      a.map((v) => Prisma.sql`${v}`),
      b.map((v) => Prisma.sql`${v}`),
    );
    const [row] = await db.$queryRaw(Prisma.sql`SELECT ${sql} value`);
    assert.ok(
      Math.abs(row.value - deltaE2000(a, b)) < 1e-9,
      JSON.stringify({ a, b, sql: row.value, js: deltaE2000(a, b) }),
    );
  }
  const owner = randomUUID(),
    other = randomUUID();
  await db.user.createMany({
    data: [owner, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  const fixtures = [];
  async function create(name, palette, options = {}) {
    const id = randomUUID(),
      own = options.owner ?? owner,
      mode = options.mode ?? 'MATERIAL';
    const data = {
      id,
      ownerId: own,
      libraryMode: mode,
      originalName: name + '.png',
      displayName: name,
      normalizedDisplayName: name,
      mimeType: 'image/png',
      format: 'png',
      byteSize: 100n,
      originalObjectKey: `users/${own}/assets/${id}/original.png`,
      lifecycleStatus: 'READY',
      mediaRevision: 2,
      isPrivate: options.private ?? false,
      deletedAt: options.deleted ? new Date() : null,
    };
    await db.eagleAsset.create({ data });
    const analysis = await db.eagleAssetColorAnalysis.create({
      data: {
        ownerId: own,
        libraryMode: mode,
        assetId: id,
        assetRevision: options.stale ? 1 : 2,
        processorVersion: options.old ? 'color-v3-thumbnail' : COLOR_PALETTE_VERSION,
        status: options.pending ? 'PENDING' : 'COMPLETED',
        isCurrent: !options.notCurrent,
      },
    });
    await db.eagleAssetColorSwatch.createMany({
      data: palette.map((color, rank) => {
        const [labL, labA, labB] = hexColorLab(color.hex);
        return {
          ownerId: own,
          libraryMode: mode,
          analysisId: analysis.id,
          rank,
          ...color,
          labL,
          labA,
          labB,
        };
      }),
    });
    const fixture = { id, name, palette, ...options };
    fixtures.push(fixture);
    return fixture;
  }
  for (const percent of [2, 3, 5, 10, 20, 25, 30, 33, 34, 40, 50, 60, 80, 95]) {
    const pixels = Uint8Array.from(
      Array.from({ length: 10000 }, (_, i) =>
        i < percent * 100 ? [255, 255, 255, 255] : [0, 0, 0, 255],
      ).flat(),
    );
    await create(`white-${percent}`, extractSearchColors(pixels, 4, 10000));
  }
  const white = [
    { hex: '#fcfcfc', weight: 0.8 },
    { hex: '#040404', weight: 0.2 },
  ];
  for (const options of [
    { owner: other },
    { mode: 'PHOTO' },
    { private: true },
    { stale: true },
    { old: true },
    { pending: true },
    { notCurrent: true },
    { deleted: true },
  ])
    await create('excluded-' + JSON.stringify(options), white, options);
  await create('white-background-blue', [
    { hex: '#fcfcfc', weight: 0.85 },
    { hex: '#0404fc', weight: 0.15 },
  ]);
  await create('black-background-blue', [
    { hex: '#040404', weight: 0.85 },
    { hex: '#0404fc', weight: 0.15 },
  ]);
  await create('gray-background', [
    { hex: '#dddddd', weight: 0.9 },
    { hex: '#040404', weight: 0.1 },
  ]);
  const ordinary = fixtures.filter(
    (row) =>
      !['owner', 'mode', 'private', 'stale', 'old', 'pending', 'notCurrent', 'deleted'].some(
        (k) => row[k],
      ),
  );
  for (const target of ['#ffffff', '#0000ff', '#040404', '#dddddd']) {
    const sql = await db.$queryRaw(
      Prisma.sql`SELECT asset.id,${colorScoreSql(target)} score FROM "EagleAsset" asset WHERE asset."ownerId"=${owner} AND asset."libraryMode"='MATERIAL' AND NOT asset."isPrivate" AND asset."deletedAt" IS NULL`,
    );
    const scores = new Map(sql.map((row) => [row.id, row.score]));
    for (const row of ordinary) {
      const expected = paletteColorScore(target, row.palette),
        actual = scores.get(row.id);
      assert.ok(
        expected === null ? actual === null : actual !== null && Math.abs(actual - expected) < 1e-9,
        JSON.stringify({ target, name: row.name, expected, actual }),
      );
    }
  }
  const service = new EagleService(db, undefined, 'MATERIAL');
  const seen = [];
  let cursor;
  do {
    const page = await service.listAssets(owner, {
      limit: 2,
      color: '#ffffff',
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (cursor) assert.ok(cursor.startsWith('color:'));
    if (seen.length > 100) throw Error('Non-terminating color cursor');
  } while (cursor);
  const expected = ordinary
    .filter((row) => paletteColorScore('#ffffff', row.palette) !== null)
    .map((row) => row.id);
  assert.deepEqual([...seen].sort(), expected.sort());
  assert.equal(new Set(seen).size, seen.length);
  const query = {
    version: 2,
    conditions: [
      {
        id: 'c',
        match: 'ALL',
        result: 'MATCH',
        rules: [{ id: 'r', field: 'COLOR', operator: 'SIMILAR', value: '#ffffff' }],
      },
    ],
  };
  const counted = await service.countAssets(owner, query);
  assert.equal(counted.count, seen.length);
  const rulesPage = await service.listAssets(owner, { limit: 100, rules: JSON.stringify(query) });
  assert.deepEqual(rulesPage.items.map((row) => row.id).sort(), expected);
  const privatePage = await service.listAssets(
    owner,
    { limit: 100, color: '#ffffff', privacy: 'PRIVATE' },
    { includePrivate: true },
  );
  assert.equal(privatePage.items.length, 1);
  const photo = new EagleService(db, undefined, 'PHOTO');
  assert.equal((await photo.listAssets(owner, { limit: 100, color: '#ffffff' })).items.length, 1);
  const first = await service.listAssets(owner, { limit: 2, color: '#ffffff' });
  assert.ok(first.nextCursor);
  const second = await service.listAssets(owner, {
    limit: 2,
    color: '#ffffff',
    cursor: first.nextCursor,
  });
  assert.ok(second.previousCursor);
  const back = await service.listAssets(owner, {
    limit: 2,
    color: '#ffffff',
    cursor: second.previousCursor,
  });
  assert.deepEqual(
    back.items.map((x) => x.id),
    first.items.map((x) => x.id),
  );
  await assert.rejects(
    () => service.listAssets(other, { limit: 2, color: '#ffffff', cursor: first.nextCursor }),
    /颜色筛选游标/,
  );
  await assert.rejects(
    () => service.listAssets(owner, { limit: 2, color: '#0000ff', cursor: first.nextCursor }),
    /颜色筛选游标/,
  );
  // Eagle's score lookup uses `score || 100`: distinct hex colors with rounded Lab distance zero sort last.
  const roundedZero = await service.listAssets(owner, { limit: 100, color: '#fdfdfd' });
  assert.equal(roundedZero.items[0].id, fixtures.find((row) => row.name === 'gray-background').id);
  run(
    process.execPath,
    ['--test', fileURLToPath(new URL('./search-query.test.mjs', import.meta.url))],
    { env, stdio: 'inherit' },
  );
  // Upgrade jobs are idempotent, current-version and thumbnail-scoped, without touching user settings.
  for (const row of fixtures.filter((row) => row.old || row.stale || row.deleted || row.private)) {
    await db.eagleAssetRendition.create({
      data: {
        ownerId: owner,
        libraryMode: 'MATERIAL',
        assetId: row.id,
        kind: 'THUMBNAIL',
        revision: 2,
        storageKey: `synthetic/${row.id}.webp`,
        mimeType: 'image/webp',
        byteSize: 100n,
        status: 'READY',
      },
    });
  }
  const legacy = fixtures.find((row) => row.old);
  await db.eagleAssetProcessingJob.create({
    data: {
      ownerId: owner,
      libraryMode: 'MATERIAL',
      assetId: legacy.id,
      assetRevision: 2,
      processorVersion: 'color-v3-thumbnail',
      kind: 'EXTRACT_COLOR_PALETTE',
      lane: 'BACKGROUND',
    },
  });
  const migration = readFileSync(
    'apps/api/prisma/migrations/20261101010000_eagle_basic_color_palette/migration.sql',
    'utf8',
  );
  // Execute each reviewed migration statement; Prisma prepared statements accept one at a time.
  for (let repeat = 0; repeat < 2; repeat++)
    for (const statement of migration
      .replace(/^--.*$/gm, '')
      .split(';')
      .filter((part) => part.trim()))
      await db.$executeRawUnsafe(statement);
  const upgraded = await db.eagleAssetProcessingJob.findMany({
    where: { ownerId: owner, processorVersion: COLOR_PALETTE_VERSION },
  });
  assert.deepEqual(
    upgraded.map((row) => row.assetId).sort(),
    fixtures
      .filter((row) => row.old || row.stale)
      .map((row) => row.id)
      .sort(),
  );
  const retired = await db.eagleAssetProcessingJob.findFirst({
    where: { assetId: legacy.id, processorVersion: 'color-v3-thumbnail' },
  });
  assert.equal(retired.status, 'COMPLETED');
  assert.equal(retired.leaseVersion, 1);
  // Sixty thousand synthetic palette facts exercise SQL ranking without S3 or model calls.
  const start = performance.now();
  await db.$executeRaw(
    Prisma.sql`INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","lifecycleStatus","mediaRevision","updatedAt") SELECT 'color-scale-'||n,${owner},'MATERIAL','scale.png','scale','scale','image/png','png',100,'synthetic/'||n,'READY',2,now() FROM generate_series(1,60000) n`,
  );
  await db.$executeRawUnsafe('ANALYZE "EagleAsset"');
  await db.$executeRaw(
    Prisma.sql`INSERT INTO "EagleAssetColorAnalysis" (id,"ownerId","libraryMode","assetId","assetRevision","processorVersion",status,"isCurrent","updatedAt") SELECT 'color-analysis-'||n,${owner},'MATERIAL','color-scale-'||n,2,${COLOR_PALETTE_VERSION},'COMPLETED',true,now() FROM generate_series(1,60000) n`,
  );
  await db.$executeRawUnsafe('ANALYZE "EagleAssetColorAnalysis"');
  await db.$executeRaw(
    Prisma.sql`INSERT INTO "EagleAssetColorSwatch" ("analysisId","ownerId","libraryMode",rank,hex,weight,"labL","labA","labB") SELECT 'color-analysis-'||n,${owner},'MATERIAL',0,CASE WHEN n%2=0 THEN '#fcfcfc' ELSE '#040404' END,0.9,CASE WHEN n%2=0 THEN 99 ELSE 1 END,0,0 FROM generate_series(1,60000) n`,
  );
  await db.$executeRawUnsafe('ANALYZE "EagleAssetColorSwatch"');
  const seededMs = performance.now() - start;
  const measurements = [],
    sqlStatementsPerMaterialPage = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    sqlCount = 0;
    measuring = true;
    const page = await service.listAssets(owner, { limit: 40, color: '#ffffff' });
    measuring = false;
    assert.equal(page.items.length, 40);
    measurements.push(performance.now() - t);
    sqlStatementsPerMaterialPage.push(sqlCount);
  }
  const distinctColors = Array.from({ length: 4096 }, (_, i) => {
    const hex =
      '#' +
      [(i >> 8) * 16 + 4, ((i >> 4) & 15) * 16 + 4, (i & 15) * 16 + 4]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
    return { hex, lab: hexColorLab(hex) };
  });
  await db.$executeRaw(Prisma.sql`UPDATE "EagleAssetColorSwatch" SET
    hex=(${distinctColors.map((c) => c.hex)}::text[])[1+(substring("analysisId" from 16)::int%4096)],
    "labL"=(${distinctColors.map((c) => c.lab[0])}::float8[])[1+(substring("analysisId" from 16)::int%4096)],
    "labA"=(${distinctColors.map((c) => c.lab[1])}::float8[])[1+(substring("analysisId" from 16)::int%4096)],
    "labB"=(${distinctColors.map((c) => c.lab[2])}::float8[])[1+(substring("analysisId" from 16)::int%4096)]
    WHERE "ownerId"=${owner} AND "analysisId" LIKE 'color-analysis-%' AND rank=0`);
  await db.$executeRawUnsafe('ANALYZE "EagleAssetColorSwatch"');
  const variedMeasurements = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    sqlCount = 0;
    measuring = true;
    const page = await service.listAssets(owner, { limit: 40, color: '#ffffff' });
    measuring = false;
    assert.equal(page.items.length, 40);
    variedMeasurements.push(performance.now() - t);
  }
  log(
    JSON.stringify(
      {
        status: 'passed',
        randomSqlMathPairs: 100,
        fixtures: fixtures.length,
        pagination: 'forward/backward without duplicates',
        isolation: 'owner/mode/private/deleted/version/status/mediaRevision',
        scale: 60000,
        seededMs,
        fullServicePageMs: measurements,
        sqlStatementsPerMaterialPage,
        distinctColors: 4096,
        variedPaletteServicePageMs: variedMeasurements,
        S3Requests: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await db?.$disconnect();
  if (started) run('docker', ['stop', name]);
}
