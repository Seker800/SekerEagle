import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import {
  assertDedicatedScaleTarget,
  evaluateScaleMeasurements,
} from './library-scale-contract.mjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const {
  assertSafeRuntimeTarget,
  describeRuntimeTarget,
} = require('../../packages/config/dist/index.js');
const { EagleService } = require('../../apps/api/dist/eagle/eagle.service.js');

const ASSET_COUNT = 100_000;
const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const runtimeTarget = {
  databaseUrl: DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
};

assertSafeRuntimeTarget(runtimeTarget);
assertDedicatedScaleTarget(DATABASE_URL);
process.stdout.write(`Scale target accepted: ${describeRuntimeTarget(runtimeTarget)}\n`);

const prisma = new PrismaClient();
const service = new EagleService(prisma);
const shouldSeed = process.argv.includes('--seed');
const shouldVerify = process.argv.includes('--verify') || !shouldSeed;

async function executePhase(name, sql) {
  const startedAt = performance.now();
  await prisma.$executeRawUnsafe(sql);
  process.stdout.write(`${name}: ${(performance.now() - startedAt).toFixed(0)}ms\n`);
}

async function seedScaleLibrary() {
  if (process.env.SEKEREAGLE_SCALE_RESET !== 'sekereagle_test') {
    throw new Error('seeding requires SEKEREAGLE_SCALE_RESET=sekereagle_test');
  }
  await executePhase('reset test database', 'TRUNCATE TABLE "User" CASCADE');
  await executePhase(
    'seed owner',
    `INSERT INTO "User" ("id", "email", "passwordHash", "role", "createdAt", "updatedAt")
     VALUES ('${OWNER_ID}', 'scale@example.invalid', 'benchmark-account-disabled', 'USER', now(), now())`,
  );
  await executePhase(
    'seed 100k assets',
    `INSERT INTO "EagleAsset" (
       "id", "ownerId", "originalName", "displayName", "normalizedDisplayName",
       "mimeType", "format", "byteSize", "sha256", "width", "height",
       "originalObjectKey", "lifecycleStatus", "mediaRevision", "rowVersion", "rating",
       "libraryAddedAt", "createdAt", "updatedAt"
     )
     SELECT
       '10000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       '${OWNER_ID}',
       CASE WHEN g % 5000 = 0 THEN 'needle-scale-' || g || '.png' ELSE 'image-' || g || '.jpg' END,
       CASE WHEN g % 5000 = 0 THEN 'needle scale ' || g ELSE '图库素材 ' || g END,
       CASE WHEN g % 5000 = 0 THEN 'needle scale ' || g ELSE '图库素材 ' || g END,
       CASE WHEN g % 10 = 0 THEN 'image/png' WHEN g % 10 = 1 THEN 'image/webp' ELSE 'image/jpeg' END,
       CASE WHEN g % 10 = 0 THEN 'png' WHEN g % 10 = 1 THEN 'webp' ELSE 'jpg' END,
       500000 + (g % 20000000),
       md5('scale-asset-' || g),
       640 + (g % 3200),
       480 + (g % 2400),
       'owners/${OWNER_ID}/originals/' || g,
       'READY', 0, 1,
       CASE WHEN g % 6 = 0 THEN NULL ELSE 1 + ((g / 10) % 5) END,
       timestamptz '2026-08-17 00:00:00+00' - g * interval '1 second',
       timestamptz '2026-08-17 00:00:00+00' - g * interval '1 second',
       timestamptz '2026-08-17 00:00:00+00' - g * interval '1 second'
     FROM generate_series(1, ${ASSET_COUNT}) AS g`,
  );
  await executePhase(
    'seed 100k thumbnails',
    `INSERT INTO "EagleAssetRendition" (
       "id", "ownerId", "assetId", "kind", "revision", "storageKey", "mimeType",
       "byteSize", "width", "height", "status", "createdAt", "updatedAt"
     )
     SELECT
       '20000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       '${OWNER_ID}',
       '10000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       'THUMBNAIL', 0,
       'owners/${OWNER_ID}/renditions/' || g || '/thumbnail.webp',
       'image/webp', 32000 + (g % 8000), 320, 240, 'READY', now(), now()
     FROM generate_series(1, ${ASSET_COUNT}) AS g`,
  );
  await executePhase(
    'seed 200 tags',
    `INSERT INTO "EagleManualTag" (
       "id", "ownerId", "name", "normalizedName", "rowVersion", "createdAt", "updatedAt"
     )
     SELECT
       '30000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       '${OWNER_ID}', '标签 ' || g, '标签 ' || g, 1, now(), now()
     FROM generate_series(1, 200) AS g`,
  );
  await executePhase(
    'seed 800k tag links',
    `INSERT INTO "EagleAssetManualTag" ("ownerId", "assetId", "tagId", "assignedByUser", "createdAt")
     SELECT
       '${OWNER_ID}',
       '10000000-0000-4000-8000-' || lpad(asset_no::text, 12, '0'),
       '30000000-0000-4000-8000-' || lpad((((asset_no + offset_no * 17) % 200) + 1)::text, 12, '0'),
       true, now()
     FROM generate_series(1, ${ASSET_COUNT}) AS asset_no
     CROSS JOIN generate_series(0, 7) AS offset_no`,
  );
  await executePhase(
    'seed 100k color analyses',
    `INSERT INTO "EagleAssetColorAnalysis" (
       "id", "ownerId", "assetId", "assetRevision", "processorVersion", "status",
       "isCurrent", "startedAt", "completedAt", "createdAt", "updatedAt"
     )
     SELECT
       '40000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       '${OWNER_ID}',
       '10000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       0, 'color-v2', 'COMPLETED', true, now(), now(), now(), now()
     FROM generate_series(1, ${ASSET_COUNT}) AS g`,
  );
  await executePhase(
    'seed 500k color swatches',
    `INSERT INTO "EagleAssetColorSwatch" (
       "ownerId", "analysisId", "rank", "hex", "weight", "labL", "labA", "labB", "createdAt"
     )
     SELECT
       '${OWNER_ID}',
       '40000000-0000-4000-8000-' || lpad(asset_no::text, 12, '0'),
       rank_no,
       '#' || substr(md5((asset_no * 10 + rank_no)::text), 1, 6),
       0.35 - rank_no * 0.04,
       10 + ((asset_no + rank_no * 7) % 80),
       -80 + ((asset_no * 3 + rank_no * 11) % 160),
       -80 + ((asset_no * 5 + rank_no * 13) % 160),
       now()
     FROM generate_series(1, ${ASSET_COUNT}) AS asset_no
     CROSS JOIN generate_series(0, 4) AS rank_no`,
  );
  await executePhase(
    'seed 100k completed background jobs',
    `INSERT INTO "EagleMediaJob" (
       "id", "ownerId", "assetId", "kind", "status", "lane", "assetRevision",
       "processorVersion", "attempts", "leaseVersion", "availableAt", "startedAt",
       "completedAt", "createdAt", "updatedAt"
     )
     SELECT
       '50000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       '${OWNER_ID}',
       '10000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       'EXTRACT_COLOR_PALETTE', 'COMPLETED', 'BACKGROUND', 0, 'color-v2', 1, 1,
       timestamptz '2026-08-01 00:00:00+00', timestamptz '2026-08-01 00:00:00+00',
       timestamptz '2026-08-01 00:01:00+00', timestamptz '2026-08-01 00:00:00+00', now()
     FROM generate_series(1, ${ASSET_COUNT}) AS g`,
  );
  await executePhase(
    'seed one interactive job',
    `INSERT INTO "EagleMediaJob" (
       "id", "ownerId", "assetId", "kind", "status", "lane", "assetRevision",
       "processorVersion", "availableAt", "createdAt", "updatedAt"
     ) VALUES (
       '50000000-0000-4000-9000-000000000001', '${OWNER_ID}',
       '10000000-0000-4000-8000-000000000001', 'GENERATE_THUMBNAIL', 'PENDING',
       'INTERACTIVE', 0, 'v1', now(), now(), now()
     )`,
  );
  await executePhase('vacuum and analyze scale data', 'VACUUM (ANALYZE)');
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

async function measure(name, operation, warmups = 2, iterations = 10) {
  for (let index = 0; index < warmups; index += 1) await operation();
  const durations = [];
  let itemCount = 0;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = await operation();
    durations.push(performance.now() - startedAt);
    itemCount = result.items?.length ?? result.length ?? 0;
  }
  return {
    name,
    iterations,
    itemCount,
    minimumMs: Math.min(...durations),
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maximumMs: Math.max(...durations),
  };
}

async function explain(name, sql, ...parameters) {
  const rows = await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    ...parameters,
  );
  const document = rows[0]['QUERY PLAN'][0];
  const nodes = [];
  const visit = (node) => {
    nodes.push(node['Node Type']);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(document.Plan);
  return {
    name,
    planningMs: document['Planning Time'],
    executionMs: document['Execution Time'],
    topNode: document.Plan['Node Type'],
    nodes,
    sharedHitBlocks: document.Plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: document.Plan['Shared Read Blocks'] ?? 0,
  };
}

async function verifyScaleLibrary() {
  const counts = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM "EagleAsset") AS "assetCount",
      (SELECT count(*)::int FROM "EagleAssetRendition") AS "renditionCount",
      (SELECT count(*)::int FROM "EagleAssetManualTag") AS "manualTagLinkCount",
      (SELECT count(*)::int FROM "EagleAssetColorSwatch") AS "swatchCount",
      (SELECT count(*)::int FROM "EagleMediaJob") AS "jobCount",
      pg_database_size(current_database())::float8 AS "databaseBytes"
  `);
  const deepRows = await prisma.$queryRawUnsafe(
    `SELECT "id", "libraryAddedAt" FROM "EagleAsset"
     WHERE "ownerId" = $1 AND "deletedAt" IS NULL
     ORDER BY "libraryAddedAt" DESC, "id" DESC OFFSET 90000 LIMIT 1`,
    OWNER_ID,
  );
  if (!deepRows[0]) throw new Error('deep cursor fixture is missing');
  const deepCursor = Buffer.from(
    JSON.stringify({
      v: 2,
      libraryAddedAt: deepRows[0].libraryAddedAt.toISOString(),
      id: deepRows[0].id,
    }),
  ).toString('base64url');
  const tag1 = '30000000-0000-4000-8000-000000000001';
  const tag18 = '30000000-0000-4000-8000-000000000018';
  const measurements = [];
  measurements.push(
    await measure('default-first-page', () => service.listAssets(OWNER_ID, { limit: 40 })),
  );
  measurements.push(
    await measure('deep-cursor', () =>
      service.listAssets(OWNER_ID, { limit: 40, cursor: deepCursor }),
    ),
  );
  measurements.push(
    await measure('name-search', () =>
      service.listAssets(OWNER_ID, { limit: 40, search: 'needle' }),
    ),
  );
  measurements.push(
    await measure('format-rating-filter', () =>
      service.listAssets(OWNER_ID, { limit: 40, formats: ['png', 'webp'], rating: 4 }),
    ),
  );
  measurements.push(
    await measure('manual-tag-all', () =>
      service.listAssets(OWNER_ID, {
        limit: 40,
        manualTagIds: [tag1, tag18],
        tagMatch: 'ALL',
      }),
    ),
  );
  measurements.push(
    await measure('color-filter', () =>
      service.listAssets(OWNER_ID, { limit: 40, color: '#808080' }),
    ),
  );
  measurements.push(
    await measure('interactive-job-candidate', () =>
      prisma.eagleAssetProcessingJob.findMany({
        where: {
          lane: 'INTERACTIVE',
          OR: [
            { status: 'PENDING', availableAt: { lte: new Date() } },
            {
              status: 'PROCESSING',
              lockedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
            },
          ],
        },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
    ),
  );
  const plans = [
    await explain(
      'default-first-page',
      `SELECT "id", "libraryAddedAt" FROM "EagleAsset"
       WHERE "ownerId" = $1 AND "deletedAt" IS NULL
       ORDER BY "libraryAddedAt" DESC, "id" DESC LIMIT 41`,
      OWNER_ID,
    ),
    await explain(
      'deep-cursor',
      `SELECT "id", "libraryAddedAt" FROM "EagleAsset"
       WHERE "ownerId" = $1 AND "deletedAt" IS NULL
         AND ("libraryAddedAt" < $2 OR ("libraryAddedAt" = $2 AND "id" < $3))
       ORDER BY "libraryAddedAt" DESC, "id" DESC LIMIT 41`,
      OWNER_ID,
      deepRows[0].libraryAddedAt,
      deepRows[0].id,
    ),
    await explain(
      'interactive-job-candidate',
      `SELECT "id" FROM "EagleMediaJob"
       WHERE "lane" = 'INTERACTIVE' AND "status" = 'PENDING' AND "availableAt" <= now()
       ORDER BY "availableAt", "createdAt" LIMIT 50`,
    ),
  ];
  const report = {
    generatedAt: new Date().toISOString(),
    target: JSON.parse(describeRuntimeTarget(runtimeTarget)),
    ...counts[0],
    measurements,
    plans,
  };
  const thresholds = {
    requiredAssetCount: ASSET_COUNT,
    maximumP95Ms: {
      'default-first-page': 200,
      'deep-cursor': 200,
      'name-search': 500,
      'format-rating-filter': 500,
      'manual-tag-all': 500,
      'color-filter': 800,
      'interactive-job-candidate': 100,
    },
    minimumItemCounts: Object.fromEntries(
      measurements.map((measurement) => [measurement.name, 1]),
    ),
  };
  const failures = evaluateScaleMeasurements(report, thresholds);
  process.stdout.write(`SCALE_REPORT ${JSON.stringify({ ...report, thresholds, failures })}\n`);
  if (failures.length) throw new Error(`scale verification failed: ${failures.join('; ')}`);
}

try {
  if (shouldSeed) await seedScaleLibrary();
  if (shouldVerify) await verifyScaleLibrary();
} finally {
  await prisma.$disconnect();
}
