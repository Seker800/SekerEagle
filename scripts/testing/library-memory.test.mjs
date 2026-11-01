import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import {
  createLibraryReadPool,
  LibraryReadStore,
} from '../../apps/api/dist/eagle/eagle-memory-store.js';
import { compileSearchPredicate } from '../../apps/api/dist/eagle/eagle-search-predicate.js';
import { buildEagleFilterWhere } from '../../apps/api/dist/eagle/eagle-filter-query.js';
import { createLibraryReaderServer } from '../../apps/api/dist/eagle/eagle-memory-server.js';
import { findSearchAssets } from '../../apps/api/dist/eagle/eagle-asset-search.js';
import { libraryReadMetrics } from '../../apps/api/dist/eagle/eagle-memory-client.js';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { log } from 'node:console';
import { PhotoManagementService } from '../../apps/api/dist/photos/photo-management.service.js';
import { readResidentPhotoFacets } from '../../apps/api/dist/photos/photo-facets-memory.js';
import { PhotoStatisticsService } from '../../apps/api/dist/photos/photo-statistics.service.js';
import { readResidentPhotoStatistics } from '../../apps/api/dist/photos/photo-statistics-memory.js';
import { residentPersonCounts } from '../../apps/api/dist/photos/photo-people-memory.js';
import { readSmartFolderPage } from '../../apps/api/dist/eagle/eagle-smart-folder-page.js';
import { readMemoryCount } from '../../apps/api/dist/eagle/eagle-memory-client.js';
import { readResidentSmartFolderPage, withResidentSemanticGraph } from '../../apps/api/dist/eagle/eagle-memory-semantic-store.js';
import { rankSmartFolderMatches } from '../../apps/api/dist/eagle/eagle-smart-folder-ranking.js';
import { smartFolderMatchWhere } from '../../packages/library-persistence/dist/index.js';
import { readPeopleCountPage } from '../../apps/api/dist/photos/photo-person-count-page.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
const ownerId = randomUUID(),
  other = randomUUID();
const personId = randomUUID(),
  unnamedPersonId = randomUUID(),
  privatePersonId = randomUUID();
const pool = createLibraryReadPool(process.env.DATABASE_URL);
const store = new LibraryReadStore(pool);
const scope = { ownerId, libraryMode: 'PHOTO' };
before(async () => {
  await db.user.createMany({
    data: [ownerId, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  await db.eagleAsset.createMany({
    data: Array.from({ length: 40 }, (_, i) => ({
      id: `${ownerId}-${i}`,
      ownerId,
      libraryMode: 'PHOTO',
      originalName: `image-${i}.jpg`,
      displayName: `image_${i}%`,
      normalizedDisplayName: `image_${i}%`,
      mimeType: 'image/jpeg',
      format: 'jpg',
      byteSize: BigInt(i + 1),
      width: i % 3 ? 4000 : null,
      height: 3000,
      rating: i % 6 || null,
      isPrivate: i % 5 === 0,
      originalObjectKey: `users/${ownerId}/assets/${i}/original`,
      libraryAddedAt: new Date(1760000000000 + i * 17),
      chronologicalAt: new Date(1760000000000 + i * 17),
    })),
  });
  await db.eaglePhotoMetadata.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      assetId: `${ownerId}-${i}`,
      ownerId,
      libraryMode: 'PHOTO',
      assetRevision: 0,
      processorVersion: 'fixture',
      cameraModel: i % 3 === 0 ? null : i % 3 === 1 ? '' : 'Camera',
      lensModel: i % 4 ? 'Lens' : null,
      cameraMake: 'Maker',
      capturedAt: i % 7 ? new Date(1793491200000 + i * 86400000) : null,
      capturedLocal: i % 7 ? `2026-11-${String(i + 1).padStart(2, '0')}T08:00:00` : null,
    })),
  });
  await db.eaglePhotoPerson.createMany({
    data: [
      { id: personId, name: 'Alpha', marksAssetsPrivate: false },
      { id: unnamedPersonId, name: null, marksAssetsPrivate: false },
      { id: privatePersonId, name: 'Private', marksAssetsPrivate: true },
    ].map((person) => ({
      ...person,
      ...scope,
      prototype: [1, ...Array(127).fill(0)],
      modelVersion: 'fixture',
    })),
  });
  await db.eaglePhotoFace.createMany({
    data: [
      [personId, 1, 0],
      [personId, 1, 0],
      [personId, 0, 0],
      [unnamedPersonId, 2, 0],
      [unnamedPersonId, 3, 0],
      [unnamedPersonId, 4, 1],
    ].map(([personId, at, assetRevision]) => ({
      ...scope,
      id: randomUUID(),
      personId,
      assetId: `${ownerId}-${at}`,
      assetRevision,
      modelVersion: 'fixture',
      box: [0, 0, 10, 10],
      embedding: [1, ...Array(127).fill(0)],
      confidence: 0.9,
    })),
  });
});
after(async () => {
  await db.eagleAsset.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
  await db.eaglePhotoPerson.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
  await db.eagleLibraryReadState.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, other] } } });
  await pool.end();
  await db.$disconnect();
});
test('resident predicates match the real SQL adapter across nulls, NOT, relations and pages', async () => {
  const index = await store.synchronize(scope);
  const conditions = [
    { width: { gt: 1000 } },
    { NOT: { width: { gt: 1000 } } },
    { normalizedDisplayName: { contains: 'IMAGE\\_', mode: 'insensitive' } },
    { byteSize: { gt: 20n } },
    { rating: null },
    { NOT: { rating: { not: 2 } } },
    { photoMetadata: { is: { cameraModel: 'Camera' } } },
    { NOT: { photoMetadata: { is: { cameraModel: 'Camera' } } } },
    { photoMetadata: { isNot: { cameraModel: 'Camera' } } },
    { photoMetadata: { is: { cameraModel: { not: 'camera', mode: 'insensitive' } } } },
    ...['EMPTY', 'NOT_EMPTY'].map((operator) =>
      buildEagleFilterWhere(
        {
          version: 2,
          conditions: [
            {
              id: 'g',
              match: 'ALL',
              result: 'MATCH',
              rules: [{ id: 'r', field: 'CAMERA_MODEL', operator }],
            },
          ],
        },
        'PHOTO',
      ),
    ),
  ];
  for (const condition of conditions) {
    const where = { AND: [{ ownerId, libraryMode: 'PHOTO', isPrivate: false }, condition] };
    const expected = await db.$queryRaw(
      Prisma.sql`SELECT asset.id FROM "EagleAsset" asset WHERE ${compileSearchPredicate(where)} ORDER BY asset."chronologicalAt" DESC,asset.id DESC`,
    );
    assert.deepEqual(
      expected,
      await db.eagleAsset.findMany({
        where,
        select: { id: true },
        orderBy: [{ chronologicalAt: 'desc' }, { id: 'desc' }],
      }),
    );
    assert.deepEqual(
      index.page(where, 'chronologicalAt', 'desc', 100, 0),
      expected.map((row) => row.id),
      JSON.stringify(condition, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    assert.equal(index.count(where), expected.length);
    assert.deepEqual(
      index.page(where, 'chronologicalAt', 'desc', 3, 3),
      expected.slice(3, 6).map((row) => row.id),
    );
  }
  assert.deepEqual(index.page({ ownerId: other }, 'chronologicalAt', 'desc', 10, 0), []);
});
test('committed updates are visible, rollback is invisible, and removed relations are refreshed', async () => {
  const before = await store.synchronize(scope);
  const revision = before.revision;
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.eagleAsset.update({ where: { id: `${ownerId}-1` }, data: { rating: 5 } });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal((await store.synchronize(scope)).revision, revision);
  await db.eagleAsset.update({ where: { id: `${ownerId}-1` }, data: { rating: 5 } });
  const after = await store.synchronize(scope);
  assert.ok(BigInt(after.revision) > BigInt(revision));
  assert.equal(after.count({ id: `${ownerId}-1`, rating: 5 }), 1);
  await db.eaglePhotoMetadata.delete({ where: { assetId: `${ownerId}-2` } });
  assert.equal(
    (await store.synchronize(scope)).count({ id: `${ownerId}-2`, photoMetadata: { is: null } }),
    1,
  );
});
test('a fresh reader reconstructs the same result after acknowledged logs are pruned', async () => {
  const current = await store.synchronize(scope);
  const restarted = await new LibraryReadStore(pool).synchronize(scope);
  assert.equal(restarted.revision, current.revision);
  assert.deepEqual(
    restarted.page({}, 'chronologicalAt', 'desc', 100, 0),
    current.page({}, 'chronologicalAt', 'desc', 100, 0),
  );
});

test('activation waits for a pre-existing uncommitted writer instead of losing its update', async () => {
  const id = `${other}-activation`;
  const otherScope = { ownerId: other, libraryMode: 'PHOTO' };
  await db.eagleAsset.create({
    data: {
      id,
      ...otherScope,
      originalName: 'activation.jpg',
      displayName: 'activation',
      normalizedDisplayName: 'activation',
      mimeType: 'image/jpeg',
      format: 'jpg',
      byteSize: 1n,
      rating: 1,
      originalObjectKey: `synthetic/${id}`,
    },
  });
  let release, written;
  const commit = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    written = resolve;
  });
  const writer = db.$transaction(
    async (tx) => {
      await tx.eagleAsset.update({ where: { id }, data: { rating: 5 } });
      written();
      await commit;
    },
    { timeout: 10000 },
  );
  await ready;
  let completed = false;
  const loading = new LibraryReadStore(pool).synchronize(otherScope).then((index) => {
    completed = true;
    return index;
  });
  let blocked = false;
  try {
    for (let i = 0; i < 100 && !completed; i++) {
      const [state] =
        await db.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='sekereagle-library-reader' AND wait_event_type='Lock') blocked`;
      if (state.blocked) {
        blocked = true;
        break;
      }
    }
    assert.equal(blocked, true, 'activation must join the transaction commit ordering');
  } finally {
    release();
    await writer;
  }
  const index = await loading;
  assert.equal(index.count({ id, rating: 5 }), 1);
});

test('shared list reads use the reader and preserve authoritative page filtering and SQL fallback', async () => {
  const savedUrl = process.env.EAGLE_READER_URL,
    savedToken = process.env.EAGLE_READER_TOKEN;
  const server = createLibraryReaderServer(store, 'isolated-reader');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  process.env.EAGLE_READER_URL = `http://127.0.0.1:${address.port}`;
  process.env.EAGLE_READER_TOKEN = 'isolated-reader';
  const args = {
    where: { ...scope, isPrivate: false },
    select: { id: true },
    orderBy: [{ chronologicalAt: 'desc' }, { id: 'desc' }],
    take: 5,
  };
  try {
    const hits = libraryReadMetrics.hits;
    assert.deepEqual(await findSearchAssets(db, args), await db.eagleAsset.findMany(args));
    assert.equal(libraryReadMetrics.hits, hits + 1);
    process.env.EAGLE_READER_TOKEN = 'wrong';
    assert.deepEqual(await findSearchAssets(db, args), await db.eagleAsset.findMany(args));
  } finally {
    if (savedUrl === undefined) delete process.env.EAGLE_READER_URL;
    else process.env.EAGLE_READER_URL = savedUrl;
    if (savedToken === undefined) delete process.env.EAGLE_READER_TOKEN;
    else process.env.EAGLE_READER_TOKEN = savedToken;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('statistics reuse resident daily facts and preserve the original chart SQL for every grain', async () => {
  const oldUrl = process.env.EAGLE_READER_URL,
    oldToken = process.env.EAGLE_READER_TOKEN;
  const server = createLibraryReaderServer(store, 'statistics-reader', 2097152, {
    statistics: (index, includePrivate, query) =>
      readResidentPhotoStatistics(pool, index, includePrivate, query),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const service = new PhotoStatisticsService(db);
  try {
    for (const grain of ['day', 'week', 'month', 'year'])
      for (const groupBy of ['total', 'camera', 'lens'])
        for (const includePrivate of [false, true]) {
          delete process.env.EAGLE_READER_URL;
          const query = { grain, groupBy };
          const expected = await service.get(ownerId, includePrivate, query);
          process.env.EAGLE_READER_URL = url;
          process.env.EAGLE_READER_TOKEN = 'statistics-reader';
          const hits = libraryReadMetrics.hits;
          assert.deepEqual(await service.get(ownerId, includePrivate, query), expected);
          assert.equal(libraryReadMetrics.hits, hits + 1);
        }
  } finally {
    if (oldUrl === undefined) delete process.env.EAGLE_READER_URL;
    else process.env.EAGLE_READER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN;
    else process.env.EAGLE_READER_TOKEN = oldToken;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('people counts reuse resident memberships while original SQL retains names, privacy and ranking', async () => {
  const oldUrl = process.env.EAGLE_READER_URL,
    oldToken = process.env.EAGLE_READER_TOKEN;
  const server = createLibraryReaderServer(store, 'people-reader', 2097152, {
    peopleCounts: (index, includePrivate) => residentPersonCounts(index, includePrivate),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const includePrivate of [false, true])
      for (const view of ['ALL', 'UNNAMED']) {
        delete process.env.EAGLE_READER_URL;
        const expected = await db.$transaction(
          (tx) => readPeopleCountPage(tx, ownerId, includePrivate, undefined, view),
          { isolationLevel: 'RepeatableRead' },
        );
        process.env.EAGLE_READER_URL = url;
        process.env.EAGLE_READER_TOKEN = 'people-reader';
        const hits = libraryReadMetrics.hits;
        const actual = await db.$transaction(
          (tx) => readPeopleCountPage(tx, ownerId, includePrivate, undefined, view),
          { isolationLevel: 'RepeatableRead' },
        );
        assert.deepEqual(actual, expected);
        assert.equal(libraryReadMetrics.hits, hits + 1);
      }
  } finally {
    if (oldUrl === undefined) delete process.env.EAGLE_READER_URL;
    else process.env.EAGLE_READER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN;
    else process.env.EAGLE_READER_TOKEN = oldToken;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sixty thousand resources publish one batch event and keep complete resident results', async () => {
  const prefix = `${ownerId}-scale-`;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize",width,height,"originalObjectKey","updatedAt")
    SELECT ${prefix}||lpad(n::text,7,'0'),${ownerId},'PHOTO',n::text||'.jpg',n::text,n::text,
      'image/jpeg','jpg',20000000,6000,4000,'synthetic/'||${prefix}||n::text,now() FROM generate_series(1,60000) n`);
  const fresh = new LibraryReadStore(pool);
  const started = performance.now();
  const index = await fresh.synchronize(scope);
  const buildMs = performance.now() - started;
  assert.equal(index.count({ id: { startsWith: prefix } }), 60000);
  const timings = [];
  for (let i = 0; i < 2; i++) {
    await db.eagleLibraryReadState.update({
      where: { ownerId_libraryMode: scope },
      data: { enabled: false },
    });
    const baselineStart = performance.now();
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
        await tx.eagleAsset.updateMany({
          where: { ...scope, id: { startsWith: prefix } },
          data: { rating: 2 },
        });
      },
      { timeout: 20000 },
    );
    const baselineMs = performance.now() - baselineStart;
    await db.eagleLibraryReadState.update({
      where: { ownerId_libraryMode: scope },
      data: { enabled: true },
    });
    const revision = (
      await db.eagleLibraryReadState.findUniqueOrThrow({ where: { ownerId_libraryMode: scope } })
    ).revision;
    const enabledStart = performance.now();
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
        await tx.eagleAsset.updateMany({
          where: { ...scope, id: { startsWith: prefix } },
          data: { rating: 3 },
        });
      },
      { timeout: 20000 },
    );
    const enabledMs = performance.now() - enabledStart;
    const changes = await db.eagleLibraryReadChange.findMany({
      where: { ...scope, revision: { gt: revision } },
    });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].assetIds.length, 60000);
    timings.push({ baselineMs: Math.round(baselineMs), enabledMs: Math.round(enabledMs) });
  }
  const refreshed = await fresh.synchronize(scope);
  assert.equal(refreshed.count({ id: { startsWith: prefix }, rating: 3 }), 60000);
  const samples = [];
  for (let i = 0; i < 110; i++) {
    const start = performance.now();
    assert.equal(
      refreshed.page(
        { photoMetadata: { is: { cameraModel: 'nonexistent' } } },
        'chronologicalAt',
        'desc',
        41,
        0,
      ).length,
      0,
    );
    if (i >= 10) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  log(
    JSON.stringify({
      fixture: '60000 read-side batch',
      buildMs: Math.round(buildMs),
      writes: timings,
      scanP95Ms: samples[95],
      rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    }),
  );
});

test('semantic resident page preserves real SQL scores, additional filters and version guards', async () => {
  const spaceId = randomUUID(), folderId = randomUUID(), snapshotId = randomUUID();
  try {
    await db.eagleEmbeddingSpace.create({ data: { id: spaceId, model: 'fixture', revision: spaceId,
      dimensions: 1024, instructionVersion: 'fixture', preprocessingVersion: 'fixture', normalized: true } });
    await db.eagleSmartFolder.create({ data: { id: folderId, ...scope, name: 'fixture', normalizedName: 'fixture', queryJson: { version: 2, conditions: [] } } });
    await db.eagleSmartFolderSemanticSnapshot.create({ data: { id: snapshotId, ...scope, folderId,
      intentKey: 'fixture', text: 'fixture', breadth: 'BALANCED', threshold: 0, spaceId, isActive: false, status: 'READY' } });
    await db.$executeRaw(Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot" SET "isActive"=true,"queryVector"=${JSON.stringify([1,...Array(1023).fill(0)])}::vector WHERE id=${snapshotId}`);
    for (let n = 0; n < 30; n++) {
      const embedding = await db.eagleAssetEmbedding.create({ data: { ...scope, assetId: `${ownerId}-${n}`, assetRevision: 0,
        spaceId, status: 'READY', isCurrent: true } });
      await db.eagleSmartFolderSemanticMatch.create({ data: { ...scope, snapshotId, embeddingId: embedding.id, similarity: Math.floor(n / 3) / 10 } });
    }
    const index = await store.synchronize(scope);
    for (const includePrivate of [false, true]) {
      const where = { AND: [{ ...scope }, smartFolderMatchWhere(scope, folderId), { photoMetadata: { is: { cameraModel: 'Camera' } } }] };
      const options = { where, folderIds: [folderId], limit: 3, ordinaryMembersPossible: false, includePrivate, trash: false };
      let after;
      do {
        const expected = await rankSmartFolderMatches(db, scope, [folderId], after, 4, includePrivate, false, undefined, where);
        const actual = await readResidentSmartFolderPage(pool, index, { ...options, after });
        assert.deepEqual(actual, expected);
        if (expected.length <= 3) break;
        after = expected[2];
      } while (after);
      await assert.rejects(readResidentSmartFolderPage(pool, index, options, 1), /workspace/);
      const server = createLibraryReaderServer(store, 'semantic-reader', 2097152, {
        smartFolderPage: (index, options) => readResidentSmartFolderPage(pool, index, options),
        semanticQuery: (index, ids, read) => withResidentSemanticGraph(pool, index, ids, graph => read(graph.context)),
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const oldUrl = process.env.EAGLE_READER_URL, oldToken = process.env.EAGLE_READER_TOKEN;
      try {
        process.env.EAGLE_READER_URL = `http://127.0.0.1:${server.address().port}`;
        process.env.EAGLE_READER_TOKEN = 'semantic-reader';
        const hits = libraryReadMetrics.hits;
        const page = await readSmartFolderPage(db, { scope, query: { limit: 3 }, folderIds: [folderId],
          folderDefinitionKey: 'fixture', includePrivate, trash: false, where, ordinaryMembersPossible: false },
          extra => db.eagleAsset.findMany({ where: { AND: [where, extra, ...(includePrivate ? [] : [{ isPrivate: false }])] } }));
        const expected = await rankSmartFolderMatches(db, scope, [folderId], undefined, 4, includePrivate, false, undefined, where);
        assert.deepEqual(page.rows.map(row => row.id), expected.slice(0, 3).map(row => row.assetId));
        assert.equal(libraryReadMetrics.hits, hits + 1);
        const visible = { AND: [where, ...(includePrivate ? [] : [{ isPrivate: false }])] };
        assert.equal(await readMemoryCount(visible), await db.eagleAsset.count({ where: visible }));
      } finally {
        if (oldUrl === undefined) delete process.env.EAGLE_READER_URL; else process.env.EAGLE_READER_URL = oldUrl;
        if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN; else process.env.EAGLE_READER_TOKEN = oldToken;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }

    }
  } finally {
    await db.eagleSmartFolder.deleteMany({ where: { id: folderId } });
    await db.eagleAssetEmbedding.deleteMany({ where: { spaceId } });
    await db.eagleEmbeddingSpace.deleteMany({ where: { id: spaceId } });
  }
});

test('photo facet HTTP results match original raw-value grouping and database collation', async () => {
  const server = createLibraryReaderServer(store, 'facets-reader', 2097152, {
    facets: (index, includePrivate) => readResidentPhotoFacets(pool, index, includePrivate),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const oldUrl = process.env.EAGLE_READER_URL, oldToken = process.env.EAGLE_READER_TOKEN;
  try {
    await db.eaglePhotoMetadata.update({ where: { assetId: `${ownerId}-7` }, data: { cameraModel: '  ' } });
    const service = new PhotoManagementService(db);
    for (const includePrivate of [false, true]) {
      delete process.env.EAGLE_READER_URL;
      const expected = await service.facets(ownerId, includePrivate);
      process.env.EAGLE_READER_URL = `http://127.0.0.1:${server.address().port}`;
      process.env.EAGLE_READER_TOKEN = 'facets-reader';
      const hits = libraryReadMetrics.hits;
      assert.deepEqual(await service.facets(ownerId, includePrivate), expected);
      assert.equal(libraryReadMetrics.hits, hits + 1);
      assert.ok(expected.cameras.includes('  '));
    }
  } finally {
    if (oldUrl === undefined) delete process.env.EAGLE_READER_URL; else process.env.EAGLE_READER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN; else process.env.EAGLE_READER_TOKEN = oldToken;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
