import { EAGLE_FILTER_FIELDS } from '../../packages/eagle-filter-core/dist/index.js';
import { sampleImageSearch } from '../../apps/api/dist/eagle/eagle-search-preview.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { before, after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { buildEagleFilterWhere } from '../../apps/api/dist/eagle/eagle-filter-query.js';
import { compileSearchPredicate } from '../../apps/api/dist/eagle/eagle-search-predicate.js';
import { EagleImageSearchService } from '../../apps/api/dist/eagle/eagle-image-search.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { smartFolderMatchWhere } from '../../packages/library-persistence/dist/index.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let measuring = false;
const measuredQueries = [];
db.$on('query', ({ query }) => {
  if (measuring) measuredQueries.push(query);
});
const ownerId = randomUUID(),
  otherOwner = randomUUID();
const ids = {
  tag: randomUUID(),
  second: randomUUID(),
  person: randomUUID(),
  folder: randomUUID(),
  snapshot: randomUUID(),
};
let space, context;
const rows = [];
before(async () => {
  await db.user.createMany({
    data: [ownerId, otherOwner].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  space =
    (await db.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } })) ??
    (await db.eagleEmbeddingSpace.create({
      data: {
        id: randomUUID(),
        model: 'Qwen/Qwen3-VL-Embedding-2B',
        revision: 'synthetic',
        dimensions: 1024,
        normalized: true,
        instructionVersion: 'image-retrieval-v1',
        preprocessingVersion: 'preview-webp-v1',
        isCurrent: true,
      },
    }));
  const vector = `[1,${Array(1023).fill(0).join(',')}]`;
  context = { status: 'READY', spaceId: space.id, vector };
  await db.eaglePhotoPerson.create({
    data: {
      id: ids.person,
      ownerId,
      libraryMode: 'PHOTO',
      name: 'Synthetic',
      modelVersion: 'synthetic',
      prototype: [1, ...Array(127).fill(0)],
    },
  });
  await db.eagleManualTag.createMany({
    data: [ids.tag, ids.second].map((id, i) => ({
      id,
      ownerId,
      libraryMode: 'PHOTO',
      name: i ? 'Other' : 'needle',
      normalizedName: i ? 'other' : 'needle',
    })),
  });
  await db.eagleSmartFolder.create({
    data: {
      id: ids.folder,
      ownerId,
      libraryMode: 'PHOTO',
      name: 'Synthetic',
      normalizedName: 'synthetic',
      queryJson: {},
    },
  });
  await db.eagleSmartFolderSemanticSnapshot.create({
    data: {
      id: ids.snapshot,
      ownerId,
      libraryMode: 'PHOTO',
      folderId: ids.folder,
      intentKey: 'synthetic',
      text: 'needle',
      breadth: 'BROAD',
      threshold: 0.25,
      spaceId: space.id,
      isActive: false,
      status: 'PENDING',
    },
  });
  await db.$executeRaw`UPDATE "EagleSmartFolderSemanticSnapshot" SET "queryVector"=${vector}::vector,status='READY',"isActive"=true WHERE id=${ids.snapshot}`;
  for (let i = 0; i < 36; i++) {
    const libraryMode = i < 30 ? 'PHOTO' : 'MATERIAL';
    const id = randomUUID();
    const own = i === 35 ? otherOwner : ownerId;
    const row = await db.eagleAsset.create({
      data: {
        id,
        ownerId: own,
        libraryMode,
        originalName: i === 2 ? '100%_cat\\中文.JPG' : `sample-${i}.jpg`,
        displayName: `sample-${i}`,
        normalizedDisplayName: i === 2 ? '100%_cat\\中文' : `sample-${i}`,
        mimeType: 'image/jpeg',
        format: i % 2 ? 'png' : 'jpeg',
        byteSize: BigInt((i + 1) * 1024 * 1024),
        originalObjectKey: `users/${own}/assets/${id}/original.jpg`,
        lifecycleStatus: 'READY',
        mediaRevision: 1,
        width: i % 4 ? 800 + i * 50 : null,
        height: i % 4 ? 600 : null,
        durationMs: i % 3 ? i * 1000 : null,
        rating: i % 3 ? (i % 5) + 1 : null,
        isPrivate: i % 11 === 0,
        deletedAt: i === 12 ? new Date() : null,
        libraryAddedAt: new Date(Date.UTC(2026, 0, (i % 10) + 1)),
        chronologicalAt: new Date(Date.UTC(2025, i % 12, 1)),
      },
    });
    rows.push(row);
    if (i % 4 === 0)
      await db.eagleAssetAnnotation.create({
        data: {
          ownerId: own,
          libraryMode,
          assetId: id,
          description: i % 8 ? '' : 'needle ocean',
          sourceUrl: i % 8 ? null : 'https://example.invalid/a',
        },
      });
    if (libraryMode === 'PHOTO') {
      if (i % 3 !== 0)
        await db.eaglePhotoMetadata.create({
          data: {
            assetId: id,
            ownerId,
            libraryMode,
            assetRevision: 1,
            processorVersion: 'synthetic',
            cameraModel: i % 2 ? 'Sony Camera' : null,
            lensModel: i % 2 ? 'Lens 35' : '',
            latitude: i % 5 ? 10 : null,
            longitude: i % 5 ? 20 : null,
          },
        });
      if (i % 4 === 0)
        await db.eaglePhotoLocation.create({
          data: {
            assetId: id,
            ownerId,
            libraryMode,
            assetRevision: 1,
            cityId: 'synthetic',
            name: '北京',
            country: 'CN',
            region: 'BJ',
            latitude: 10,
            longitude: 20,
            suggestionId: randomUUID(),
          },
        });
      if (i % 5 === 0)
        await db.eaglePhotoFace.create({
          data: {
            id: randomUUID(),
            assetId: id,
            ownerId,
            libraryMode,
            assetRevision: 1,
            modelVersion: 'synthetic',
            personId: ids.person,
            box: [0, 0, 1, 1],
            embedding: [1, ...Array(127).fill(0)],
            confidence: 0.5,
          },
        });
      if (i % 3 === 0)
        await db.eagleAssetManualTag.create({
          data: { ownerId, libraryMode, assetId: id, tagId: ids.tag },
        });
      if (i % 7 === 0)
        await db.eagleAssetManualTag.create({
          data: { ownerId, libraryMode, assetId: id, tagId: ids.second },
        });
    }
    if (i % 4 === 0) {
      const analysis = await db.eagleAssetColorAnalysis.create({
        data: {
          ownerId: own,
          libraryMode,
          assetId: id,
          assetRevision: 1,
          processorVersion: 'color-v3-thumbnail',
          status: 'COMPLETED',
          isCurrent: true,
        },
      });
      await db.eagleAssetColorSwatch.create({
        data: {
          ownerId: own,
          libraryMode,
          analysisId: analysis.id,
          rank: 0,
          hex: '#aabbcc',
          weight: 1,
          labL: 75,
          labA: 0,
          labB: -10,
        },
      });
    }
    const embeddingId = randomUUID();
    await db.$executeRaw`INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent",embedding,"l2Norm","updatedAt") VALUES (${embeddingId},${own},${libraryMode}::"LibraryMode",${id},1,${space.id},'READY',true,${vector}::vector,1,now())`;
    if (libraryMode === 'PHOTO' && i % 2 === 0)
      await db.eagleSmartFolderSemanticMatch.create({
        data: { ownerId, libraryMode, embeddingId, snapshotId: ids.snapshot, similarity: 1 },
      });
  }
});
after(() => db.$disconnect());
async function parity(where) {
  const canonical = await db.eagleAsset.findMany({
    where,
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const predicate = compileSearchPredicate(where);
  const actual =
    await db.$queryRaw`SELECT asset.id FROM "EagleAsset" asset WHERE ${predicate} ORDER BY asset.id`;
  assert.deepEqual(
    actual,
    canonical,
    JSON.stringify(where, (_, value) => (typeof value === 'bigint' ? String(value) : value)),
  );
}
const cases = {
  NAME: [
    ['CONTAINS', 'sample'],
    ['NOT_CONTAINS', '2'],
    ['STARTS_WITH', 'sample-1'],
    ['ENDS_WITH', '1'],
    ['EQUALS', 'sample-1'],
    ['NOT_EQUALS', 'sample-2'],
    ['EMPTY', ''],
    ['NOT_EMPTY', ''],
  ],
  DESCRIPTION: [
    ['CONTAINS', 'ocean'],
    ['NOT_CONTAINS', 'ocean'],
    ['EMPTY', ''],
    ['NOT_EMPTY', ''],
  ],
  SOURCE_URL: [
    ['CONTAINS', 'example'],
    ['EMPTY', ''],
    ['NOT_EMPTY', ''],
  ],
  FORMAT: [
    ['EQUALS', 'png'],
    ['NOT_EQUALS', 'png'],
  ],
  RATING: [
    ['EQUALS', '0'],
    ['NOT_EQUALS', '0'],
    ['GTE', '3'],
    ['LTE', '2'],
    ['EQUALS', '4'],
    ['NOT_EQUALS', '4'],
  ],
  WIDTH: [
    ['GT', 1000],
    ['GTE', 1000],
    ['LT', 1000],
    ['LTE', 1000],
    ['NOT_EQUALS', 1000],
    ['BETWEEN', [900, 1300]],
  ],
  HEIGHT: [['EQUALS', 600]],
  FILE_SIZE: [
    ['GT', 10],
    ['BETWEEN', [3, 15]],
  ],
  DURATION: [
    ['GT', 5],
    ['BETWEEN', [2, 8]],
  ],
  SHAPE: [
    ['EQUALS', 'LANDSCAPE'],
    ['NOT_EQUALS', 'SQUARE'],
    ['EQUALS', 'PANORAMA'],
  ],
  COLOR: [['EQUALS', '#aabbcc']],
  ADDED_AT: [
    ['BETWEEN', ['2026-01-02', '2026-01-07']],
    ['BEFORE', '2026-01-05'],
    ['AFTER', '2026-01-05'],
    ['WITHIN_DAYS', 5],
  ],
  MODIFIED_AT: [['BEFORE', '2020-01-01']],
  CITY: [
    ['CONTAINS', '北京'],
    ['EMPTY', ''],
    ['NOT_EMPTY', ''],
  ],
  CAMERA_MODEL: [
    ['CONTAINS', 'sony'],
    ['EQUALS', 'Sony Camera'],
    ['EMPTY', ''],
    ['NOT_EMPTY', ''],
    ['NOT_EQUALS', 'Sony Camera'],
  ],
  LENS_MODEL: [
    ['CONTAINS', 'lens'],
    ['EMPTY', ''],
    ['NOT_EMPTY', ''],
  ],
  GPS: [
    ['EQUALS', 'WITH'],
    ['EQUALS', 'WITHOUT'],
  ],
  PERSON: [['EQUALS', 'PERSON']],
  MANUAL_TAGS: [
    ['ANY_OF', 'TAGS'],
    ['ALL_OF', 'TAGS'],
    ['NONE_OF', 'TAGS'],
    ['EMPTY', []],
    ['NOT_EMPTY', []],
  ],
  AI_TAGS: [
    ['ANY_OF', 'TAGS'],
    ['ALL_OF', 'TAGS'],
    ['NONE_OF', 'TAGS'],
    ['EMPTY', []],
    ['NOT_EMPTY', []],
  ],
};
test('every ordinary shared filter field/operator preserves Prisma membership, nulls and negation in SQL', async () => {
  assert.deepEqual(
    Object.keys(cases).sort(),
    EAGLE_FILTER_FIELDS.filter(({ field }) => field !== 'SEMANTIC')
      .map(({ field }) => field)
      .sort(),
    'new filter fields require SQL parity coverage',
  );
  let comparisons = 0;
  for (const [field, variants] of Object.entries(cases))
    for (const [operator, raw] of variants) {
      const value = raw === 'TAGS' ? [ids.tag, ids.second] : raw === 'PERSON' ? ids.person : raw;
      const filter = {
        version: 2,
        conditions: [
          {
            id: 'condition',
            match: 'ALL',
            result: 'MATCH',
            rules: [{ id: 'rule', field, operator, value }],
          },
        ],
      };
      const compiled = buildEagleFilterWhere(filter, 'PHOTO');
      for (const predicate of [compiled, { NOT: compiled }]) {
        await parity({
          ownerId,
          libraryMode: 'PHOTO',
          deletedAt: null,
          isPrivate: false,
          AND: [predicate],
        });
        comparisons++;
      }
    }
  for (const special of [
    { OR: [] },
    { AND: [] },
    { NOT: [] },
    { id: { in: [] } },
    { id: { notIn: [] } },
    { OR: [{ rating: null }, { width: { gt: 1200 } }] },
  ])
    await parity({ ownerId, libraryMode: 'PHOTO', ...special });
  assert.equal(comparisons, 134);
});
test('semantic folder readiness and nested owner/mode relations stay inside the same scoped SQL', async () => {
  const membership = smartFolderMatchWhere({ ownerId, libraryMode: 'PHOTO' }, ids.folder);
  const readiness = {
    owner: {
      eagleSmartFolders: {
        some: {
          id: ids.folder,
          ownerId,
          libraryMode: 'PHOTO',
          semanticSnapshots: { some: { ownerId, libraryMode: 'PHOTO', isActive: true } },
        },
      },
    },
  };
  await parity({ ownerId, libraryMode: 'PHOTO', AND: [membership, readiness] });
  await parity({ ownerId, libraryMode: 'PHOTO', AND: [{ NOT: membership }, readiness] });
});
test('literal text matching, filtered relevance and both date orders retain the same visible results', async () => {
  for (const libraryMode of ['MATERIAL', 'PHOTO']) {
    const ranker = new EagleImageSearchService(db, {}, libraryMode);
    const scope = { ownerId, libraryMode, deletedAt: null, isPrivate: false, rating: { gte: 2 } };
    const expected = await db.eagleAsset.findMany({ where: scope });
    for (const sort of [undefined, 'CAPTURED_AT', 'ADDED_AT']) {
      const actual = await ranker.rankPage(
        ownerId,
        'unmatched-text',
        context,
        undefined,
        100,
        false,
        false,
        compileSearchPredicate(scope),
        sort,
      );
      assert.deepEqual(
        actual.map((row) => row.assetId).sort(),
        expected.map((row) => row.id).sort(),
      );
    }
  }
  const ranker = new EagleImageSearchService(db, {}, 'PHOTO');
  const literal = await ranker.rankPage(
    ownerId,
    '100%_cat\\中文',
    { status: 'UNAVAILABLE', spaceId: space.id },
    undefined,
    100,
    false,
    false,
  );
  assert.deepEqual(
    literal.map((row) => row.assetId),
    [rows[2].id],
  );
});
test('filtered results are complete past 1000 matches and cursor pages remain disjoint and ordered', async (t) => {
  const newIds = Array.from({ length: 1053 }, () => randomUUID());
  await db.eagleAsset.createMany({
    data: newIds.map((id) => ({
      id,
      ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'synthetic.jpg',
      displayName: 'synthetic',
      normalizedDisplayName: 'synthetic',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1n,
      originalObjectKey: `users/${ownerId}/assets/${id}/original.jpg`,
      lifecycleStatus: 'READY',
      mediaRevision: 1,
      rating: 5,
      libraryAddedAt: new Date('2026-01-01'),
    })),
  });
  await db.$executeRaw`INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent",embedding,"l2Norm","updatedAt") SELECT gen_random_uuid()::text,${ownerId},'MATERIAL',a.id,1,${space.id},'READY',true,${context.vector}::vector,1,now() FROM "EagleAsset" a WHERE a.id=ANY(${newIds}::text[])`;
  const ranker = new EagleImageSearchService(db, {}, 'MATERIAL');
  const service = new EagleService(
    db,
    { prepare: async () => context, rankPage: ranker.rankPage.bind(ranker) },
    'MATERIAL',
  );
  let cursor,
    seen = [];
  do {
    if (!cursor) {
      await setImmediate();
      measuring = true;
    }
    const result = await service.listAssets(ownerId, {
      search: 'unmatched-text',
      rating: 5,
      limit: 40,
      ...(cursor ? { cursor } : {}),
    });
    if (!cursor) {
      await setImmediate();
      measuring = false;
      t.diagnostic(
        JSON.stringify({
          fixture: 'material-search-first-page',
          items: result.items.length,
          sql: measuredQueries.length,
          explicitTransactions: measuredQueries.filter((query) => query === 'BEGIN').length,
          preparedVector: true,
          s3: 0,
        }),
      );
    }
    seen.push(...result.items.map((row) => row.id));
    cursor = result.nextCursor;
  } while (cursor);
  const expected = await db.eagleAsset.findMany({
    where: {
      ownerId,
      libraryMode: 'MATERIAL',
      rating: { gte: 5 },
      isPrivate: false,
      deletedAt: null,
    },
    orderBy: [{ libraryAddedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual(
    seen,
    expected.map((row) => row.id),
  );
  assert.ok(seen.length > 1000);
});

test('sampled ANN previews enforce owner, mode, privacy and current media revision without leaking transaction settings', async () => {
  const [before] = await db.$queryRawUnsafe('SHOW hnsw.ef_search');
  const sample = await sampleImageSearch(
    db,
    { ownerId, libraryMode: 'PHOTO' },
    context,
    0.25,
    false,
  );
  const allowed = new Set(
    rows
      .filter(
        (row) =>
          row.ownerId === ownerId &&
          row.libraryMode === 'PHOTO' &&
          !row.isPrivate &&
          !row.deletedAt,
      )
      .map((row) => row.id),
  );
  assert.ok(sample.length > 0);
  assert.ok(sample.every((row) => allowed.has(row.id)));
  const [after] = await db.$queryRawUnsafe('SHOW hnsw.ef_search');
  assert.deepEqual(after, before);
});

test('semantic reads exclude stale vectors and preserve explicitly unlocked private and trash scopes', async () => {
  const ranker = new EagleImageSearchService(db, {}, 'PHOTO');
  const stale = rows[1];
  await db.eagleAsset.update({ where: { id: stale.id }, data: { mediaRevision: 2 } });
  try {
    const actual = await ranker.rankPage(
      ownerId,
      'unmatched-text',
      context,
      undefined,
      100,
      true,
      false,
    );
    assert.ok(!actual.some((row) => row.assetId === stale.id));
    assert.ok(
      actual.some((row) => row.assetId === rows[11].id),
      'explicitly unlocked private reads remain available',
    );
    assert.ok(actual.every((row) => row.assetId !== rows[12].id));
    const trashed = await ranker.rankPage(
      ownerId,
      'unmatched-text',
      context,
      undefined,
      100,
      true,
      true,
    );
    assert.deepEqual(
      trashed.map((row) => row.assetId),
      [rows[12].id],
    );
  } finally {
    await db.eagleAsset.update({ where: { id: stale.id }, data: { mediaRevision: 1 } });
  }
});
