import { setTimeout, clearTimeout } from 'node:timers';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { photoStatisticsFactFieldsSql } from '../../apps/api/dist/photos/photo-statistics-query.js';
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
import {
  readResidentSmartFolderPage,
  withResidentSemanticGraph,
} from '../../apps/api/dist/eagle/eagle-memory-semantic-store.js';
import { rankSmartFolderMatches } from '../../apps/api/dist/eagle/eagle-smart-folder-ranking.js';
import { smartFolderMatchWhere } from '../../packages/library-persistence/dist/index.js';
import { readPeopleCountPage } from '../../apps/api/dist/photos/photo-person-count-page.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ adapter: createPrismaAdapter() });
const ownerId = randomUUID(),
  other = randomUUID();
const personId = randomUUID(),
  unnamedPersonId = randomUUID(),
  privatePersonId = randomUUID();
const pool = createLibraryReadPool(process.env.DATABASE_URL);
const store = new LibraryReadStore(pool, photoStatisticsFactFieldsSql());
const scope = { ownerId, libraryMode: 'PHOTO' };
const savedReaderActions = process.env.EAGLE_READER_ACTIONS;
before(async () => {
  process.env.EAGLE_READER_ACTIONS = 'page,count,statistics,facets,peopleCounts,smartFolderPage,colorPage';
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
  if (savedReaderActions === undefined) delete process.env.EAGLE_READER_ACTIONS; else process.env.EAGLE_READER_ACTIONS = savedReaderActions;
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
test('source-aware commits refresh only the changed information and preserve old snapshots', async () => {
  const statements = [];
  const observedPool = {
    query: (sql, ...args) => {
      statements.push(sql);
      return pool.query(sql, ...args);
    },
    connect: async () => {
      const connection = await pool.connect();
      return {
        query: (sql, ...args) => {
          statements.push(sql);
          return connection.query(sql, ...args);
        },
        release: () => connection.release(),
      };
    },
  };
  const observed = new LibraryReadStore(observedPool, photoStatisticsFactFieldsSql());
  const old = await observed.synchronize(scope);
  await db.eagleAssetAnnotation.create({
    data: { ...scope, assetId: `${ownerId}-1`, description: 'updated in memory' },
  });
  statements.length = 0;
  const updated = await observed.read(scope);
  assert.equal(updated.count({ annotation: { is: { description: 'updated in memory' } } }), 1);
  assert.equal(old.count({ annotation: { is: { description: 'updated in memory' } } }), 0);
  assert.equal(statements.filter((sql) => sql.includes('FROM "EagleAssetAnnotation"')).length, 1);
  assert.equal(
    statements.filter((sql) =>
      /FROM "EagleAssetAiTag"|FROM "EaglePhotoFace"|FROM "EagleAssetColorAnalysis"/.test(sql),
    ).length,
    0,
  );
  assert.equal(statements.filter((sql) => sql.includes('FROM "EagleAsset" a WHERE')).length, 0);
  statements.length = 0;
  for (let n = 0; n < 3; n++) assert.equal(await observed.read(scope), updated);
  assert.equal(statements.length, 3, 'hot reads perform exactly one revision query each');
  await db.eagleAssetAnnotation.delete({
    where: { ownerId_assetId: { ownerId, assetId: `${ownerId}-1` } },
  });
  assert.equal(
    (await observed.read(scope)).count({ id: `${ownerId}-1`, annotation: { is: null } }),
    1,
  );
  await db.eagleAsset.update({ where: { id: `${ownerId}-1` }, data: { isPrivate: true } });
  const privateIndex = await observed.read(scope);
  assert.equal(privateIndex.count({ id: `${ownerId}-1`, isPrivate: false }), 0);
  assert.equal(privateIndex.count({ id: `${ownerId}-1` }), 1);
  await db.eagleAsset.update({ where: { id: `${ownerId}-1` }, data: { deletedAt: new Date() } });
  assert.equal((await observed.read(scope)).count({ id: `${ownerId}-1`, deletedAt: null }), 0);
  await db.eagleAsset.update({
    where: { id: `${ownerId}-1` },
    data: { isPrivate: false, deletedAt: null },
  });
  assert.equal(
    (await observed.read(scope)).count({ id: `${ownerId}-1`, isPrivate: false, deletedAt: null }),
    1,
  );
});

test('real database foreground catch-up never waits for a slow background refresh', async () => {
  let hold = false;
  let release, entered;
  const blocked = new Promise((resolve) => {
    entered = resolve;
  });
  const resumed = new Promise((resolve) => {
    release = resolve;
  });
  const controlled = {
    query: (...args) => pool.query(...args),
    connect: async () => {
      const connection = await pool.connect();
      return {
        query: async (sql, ...args) => {
          if (hold && sql.includes('FROM "EagleAssetAnnotation"')) {
            hold = false;
            entered();
            await resumed;
          }
          return connection.query(sql, ...args);
        },
        release: () => connection.release(),
      };
    },
  };
  const reader = new LibraryReadStore(controlled, photoStatisticsFactFieldsSql());
  await reader.synchronize(scope);
  await db.eagleAssetAnnotation.create({
    data: { ...scope, assetId: `${ownerId}-1`, description: 'foreground sees committed change' },
  });
  hold = true;
  const background = reader.synchronize(scope);
  await blocked;
  let timeout;
  try {
    const current = await Promise.race([
      reader.read(scope),
      new Promise(
        (_, reject) =>
          (timeout = setTimeout(() => reject(new Error('foreground waited for background')), 3000)),
      ),
    ]);
    assert.equal(
      current.count({ annotation: { is: { description: 'foreground sees committed change' } } }),
      1,
    );
    assert.ok(
      await db.eagleLibraryReadChange.count({ where: scope }),
      'unpublished reader retains its journal',
    );
  } finally {
    clearTimeout(timeout);
    release();
    await background;
    await db.eagleAssetAnnotation.delete({
      where: { ownerId_assetId: { ownerId, assetId: `${ownerId}-1` } },
    });
  }
});

test('a fresh reader reconstructs the same result after acknowledged logs are pruned', async () => {
  const current = await store.synchronize(scope);
  const restarted = await new LibraryReadStore(pool, photoStatisticsFactFieldsSql()).synchronize(
    scope,
  );
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
  const loading = new LibraryReadStore(pool, photoStatisticsFactFieldsSql())
    .synchronize(otherScope)
    .then((index) => {
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
  const fresh = new LibraryReadStore(pool, photoStatisticsFactFieldsSql());
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
    await db.$executeRaw`ALTER TABLE "EagleAsset" DISABLE TRIGGER library_read_update`;
    const baselineStart = performance.now();
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30000ms'");
          await tx.eagleAsset.updateMany({
            where: { ...scope, id: { startsWith: prefix } },
            data: { rating: 2 },
          });
        },
        { timeout: 40000 },
      );
    } finally {
      await db.$executeRaw`ALTER TABLE "EagleAsset" ENABLE TRIGGER library_read_update`;
    }
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
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30000ms'");
        await tx.eagleAsset.updateMany({
          where: { ...scope, id: { startsWith: prefix } },
          data: { rating: 3 },
        });
      },
      { timeout: 40000 },
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
  const spaceId = randomUUID(),
    folderId = randomUUID(),
    snapshotId = randomUUID();
  try {
    await db.eagleEmbeddingSpace.create({
      data: {
        id: spaceId,
        model: 'fixture',
        revision: spaceId,
        dimensions: 1024,
        instructionVersion: 'fixture',
        preprocessingVersion: 'fixture',
        normalized: true,
      },
    });
    await db.eagleSmartFolder.create({
      data: {
        id: folderId,
        ...scope,
        name: 'fixture',
        normalizedName: 'fixture',
        queryJson: { version: 2, conditions: [] },
      },
    });
    await db.eagleSmartFolderSemanticSnapshot.create({
      data: {
        id: snapshotId,
        ...scope,
        folderId,
        intentKey: 'fixture',
        text: 'fixture',
        breadth: 'BALANCED',
        threshold: 0,
        spaceId,
        isActive: false,
        status: 'READY',
      },
    });
    await db.$executeRaw(
      Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot" SET "isActive"=true,"queryVector"=${JSON.stringify([1, ...Array(1023).fill(0)])}::vector WHERE id=${snapshotId}`,
    );
    for (let n = 0; n < 30; n++) {
      const embedding = await db.eagleAssetEmbedding.create({
        data: {
          ...scope,
          assetId: `${ownerId}-${n}`,
          assetRevision: 0,
          spaceId,
          status: 'READY',
          isCurrent: true,
        },
      });
      await db.eagleSmartFolderSemanticMatch.create({
        data: {
          ...scope,
          snapshotId,
          embeddingId: embedding.id,
          similarity: Math.floor(n / 3) / 10,
        },
      });
    }
    const index = await store.synchronize(scope);
    for (const includePrivate of [false, true]) {
      const where = {
        AND: [
          { ...scope },
          smartFolderMatchWhere(scope, folderId),
          { photoMetadata: { is: { cameraModel: 'Camera' } } },
        ],
      };
      const options = {
        where,
        folderIds: [folderId],
        limit: 3,
        ordinaryMembersPossible: false,
        includePrivate,
        trash: false,
      };
      let after;
      do {
        const expected = await rankSmartFolderMatches(
          db,
          scope,
          [folderId],
          after,
          4,
          includePrivate,
          false,
          undefined,
          where,
        );
        const actual = await readResidentSmartFolderPage(index, { ...options, after });
        assert.deepEqual(actual.positions, expected);
        if (expected.length <= 3) break;
        after = expected[2];
      } while (after);
      assert.throws(() => readResidentSmartFolderPage(index, options, 1), /workspace/);
      await db.eagleAsset.update({ where: { id: `${ownerId}-39` }, data: { rating: 2 } });
      const laggedCacheRead = readResidentSmartFolderPage(await store.read(scope), options);
      assert.ok(Array.isArray(laggedCacheRead.positions));
      const beforePublication = await rankSmartFolderMatches(
        db,
        scope,
        [folderId],
        undefined,
        4,
        includePrivate,
        false,
        undefined,
        where,
      );
      let published = false;
      const overlappingPool = {
        query: (...args) => pool.query(...args),
        connect: async () => {
          const connection = await pool.connect();
          return {
            query: async (sql, values) => {
              const result = await connection.query(sql, values);
              if (!published && sql.includes('FROM "EagleSmartFolderSemanticMatch"')) {
                published = true;
                await db.eagleAsset.update({
                  where: { id: `${ownerId}-39` },
                  data: { rating: includePrivate ? 1 : 3 },
                });
                await store.synchronize(scope);
              }
              return result;
            },
            release: () => connection.release(),
          };
        },
      };
      const overlappingIndex = await new LibraryReadStore(
        overlappingPool,
        photoStatisticsFactFieldsSql(),
      ).synchronize(scope);
      assert.deepEqual(
        readResidentSmartFolderPage(overlappingIndex, options).positions,
        beforePublication,
      );
      assert.ok(published);

      const hotStatements = [];
      const observedPool = {
        query: (sql, ...args) => {
          hotStatements.push(sql);
          return pool.query(sql, ...args);
        },
        connect: async () => {
          const connection = await pool.connect();
          return {
            query: (sql, ...args) => {
              hotStatements.push(sql);
              return connection.query(sql, ...args);
            },
            release: () => connection.release(),
          };
        },
      };
      const observed = new LibraryReadStore(observedPool, photoStatisticsFactFieldsSql());
      const stable = await observed.synchronize(scope);
      hotStatements.length = 0;
      const samples = [];
      for (let n = 0; n < 10; n++) {
        const started = performance.now();
        const hot = await observed.read(scope);
        assert.equal(hot.semanticFolders, stable.semanticFolders);
        readResidentSmartFolderPage(hot, options);
        samples.push(performance.now() - started);
      }
      assert.equal(hotStatements.length, 10, 'semantic hot requests perform only commit fences');
      assert.ok(hotStatements.every((sql) => sql.startsWith('SELECT revision,enabled')));
      log(
        JSON.stringify({
          fixture: 'resident semantic hot reads',
          requests: 10,
          sql: hotStatements.length,
          semanticReloads: 0,
          transactions: 0,
          maxMs: Math.max(...samples),
        }),
      );

      const server = createLibraryReaderServer(store, 'semantic-reader', 2097152, {
        smartFolderPage: (index, options) => readResidentSmartFolderPage(index, options),
        semanticQuery: (index, ids, read) =>
          withResidentSemanticGraph(index, ids, (graph, view) => read(graph.context, view)),
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const oldUrl = process.env.EAGLE_READER_URL,
        oldToken = process.env.EAGLE_READER_TOKEN;
      try {
        process.env.EAGLE_READER_URL = `http://127.0.0.1:${server.address().port}`;
        process.env.EAGLE_READER_TOKEN = 'semantic-reader';
        const hits = libraryReadMetrics.hits;
        const page = await readSmartFolderPage(
          db,
          {
            scope,
            query: { limit: 3 },
            folderIds: [folderId],
            folderDefinitionKey: 'fixture',
            includePrivate,
            trash: false,
            where,
            ordinaryMembersPossible: false,
          },
          (extra) =>
            db.eagleAsset.findMany({
              where: { AND: [where, extra, ...(includePrivate ? [] : [{ isPrivate: false }])] },
            }),
        );
        const expected = await rankSmartFolderMatches(
          db,
          scope,
          [folderId],
          undefined,
          4,
          includePrivate,
          false,
          undefined,
          where,
        );
        assert.deepEqual(
          page.rows.map((row) => row.id),
          expected.slice(0, 3).map((row) => row.assetId),
        );
        assert.equal(libraryReadMetrics.hits, hits + 1);
        const visible = { AND: [where, ...(includePrivate ? [] : [{ isPrivate: false }])] };
        assert.equal(await readMemoryCount(visible), await db.eagleAsset.count({ where: visible }));
      } finally {
        if (oldUrl === undefined) delete process.env.EAGLE_READER_URL;
        else process.env.EAGLE_READER_URL = oldUrl;
        if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN;
        else process.env.EAGLE_READER_TOKEN = oldToken;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
    const prior = await store.read(scope);
    const embedding = await db.eagleAssetEmbedding.findFirstOrThrow({
      where: { ...scope, spaceId, assetId: `${ownerId}-2` },
    });
    const matchWhere = { snapshotId_embeddingId: { snapshotId, embeddingId: embedding.id } };
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.eagleSmartFolderSemanticMatch.update({
          where: matchWhere,
          data: { similarity: 0.99 },
        });
        throw new Error('rollback semantic change');
      }),
      /rollback semantic change/,
    );
    assert.equal((await store.read(scope)).revision, prior.revision);
    await db.eagleSmartFolderSemanticMatch.update({
      where: matchWhere,
      data: { similarity: 0.99 },
    });
    const rescored = await store.read(scope);
    assert.equal(rescored.semanticFolders.get(folderId).scores.get(`${ownerId}-2`).get(0), 0.99);
    assert.notEqual(prior.semanticFolders.get(folderId).scores.get(`${ownerId}-2`).get(0), 0.99);
    await db.eagleSmartFolderSemanticSnapshot.update({
      where: { id: snapshotId },
      data: { isActive: false },
    });
    assert.equal((await store.read(scope)).semanticFolders.has(folderId), false);
    await db.eagleSmartFolderSemanticSnapshot.update({
      where: { id: snapshotId },
      data: { isActive: true },
    });
    assert.equal(
      (await store.read(scope)).semanticFolders.get(folderId).scores.get(`${ownerId}-2`).get(0),
      0.99,
    );
    await db.eagleAssetEmbedding.delete({ where: { id: embedding.id } });
    assert.equal(
      (await store.read(scope)).semanticFolders.get(folderId).scores.has(`${ownerId}-2`),
      false,
    );
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
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const oldUrl = process.env.EAGLE_READER_URL,
    oldToken = process.env.EAGLE_READER_TOKEN;
  try {
    await db.eaglePhotoMetadata.update({
      where: { assetId: `${ownerId}-7` },
      data: { cameraModel: '  ' },
    });
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
    if (oldUrl === undefined) delete process.env.EAGLE_READER_URL;
    else process.env.EAGLE_READER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.EAGLE_READER_TOKEN;
    else process.env.EAGLE_READER_TOKEN = oldToken;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('color pages preserve SQL scores, mixed-engine cursors, reverse pages and OR membership', async () => {
  const { hexColorLab, COLOR_PALETTE_VERSION } =
    await import('../../packages/library-core/dist/index.js');
  const { readColorAssetPage } = await import('../../apps/api/dist/eagle/eagle-color-page.js');
  const ids = Array.from({ length: 20 }, (_, at) => `${ownerId}-${at}`);
  for (let at = 0; at < ids.length; at++) {
    const analysis = await db.eagleAssetColorAnalysis.create({
      data: {
        ...scope,
        assetId: ids[at],
        assetRevision: 0,
        processorVersion: COLOR_PALETTE_VERSION,
        status: 'COMPLETED',
        isCurrent: true,
      },
    });
    const palette = [
      { hex: ['#69696a', '#ffffff', '#fcfcfc', '#0000ff', '#202020'][at % 5], weight: 0.8 },
      { hex: '#0404fc', weight: 0.2 },
    ];
    await db.eagleAssetColorSwatch.createMany({
      data: palette.map((swatch, rank) => {
        const [labL, labA, labB] = hexColorLab(swatch.hex);
        return { ...scope, analysisId: analysis.id, rank, ...swatch, labL, labA, labB };
      }),
    });
  }
  const server = createLibraryReaderServer(store, 'color-reader');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const oldUrl = process.env.EAGLE_READER_URL,
    oldToken = process.env.EAGLE_READER_TOKEN;
  try {
    process.env.EAGLE_READER_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.EAGLE_READER_TOKEN = 'color-reader';
    for (const color of ['#777777', '#ffffff', '#0000ff']) {
      const where = {
        AND: [
          { ...scope, id: { in: ids }, deletedAt: null, isPrivate: false },
          { OR: [{ colorMatch: color }, { rating: 4 }] },
        ],
      };
      let cursor;
      do {
        const query = { limit: 3, ...(cursor ? { cursor } : {}) };
        const expected = await readColorAssetPage(
          db,
          scope,
          query,
          where,
          color,
          false,
          false,
          false,
        );
        const hits = libraryReadMetrics.hits;
        const actual = await readColorAssetPage(db, scope, query, where, color, false, false);
        assert.deepEqual(actual, expected);
        assert.equal(libraryReadMetrics.hits, hits + 1);
        if (actual.previousCursor) {
          const backwards = { limit: 3, cursor: actual.previousCursor };
          assert.deepEqual(
            await readColorAssetPage(db, scope, backwards, where, color, false, false),
            await readColorAssetPage(db, scope, backwards, where, color, false, false, false),
          );
        }
        cursor = expected.nextCursor;
      } while (cursor);
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

test('tag renames refresh only their linked resources and tag deletion clears those memberships', async () => {
  const tag = await db.eagleManualTag.create({
    data: { ...scope, name: 'before', normalizedName: 'before' },
  });
  try {
    const assetIds = [1, 2].map((at) => `${ownerId}-${at}`);
    await db.eagleAssetManualTag.createMany({
      data: assetIds.map((assetId) => ({ ...scope, assetId, tagId: tag.id })),
    });
    const index = await store.synchronize(scope);
    const revision = BigInt(index.revision);
    assert.equal(
      index.count({ manualTagLinks: { some: { tag: { normalizedName: 'before' } } } }),
      2,
    );
    await db.eagleManualTag.update({
      where: { id: tag.id },
      data: { name: 'after', normalizedName: 'after' },
    });
    const events = await db.eagleLibraryReadChange.findMany({
      where: { ...scope, revision: { gt: revision } },
    });
    assert.ok(events.length);
    assert.ok(events.every((event) => !event.rebuild));
    assert.deepEqual(
      [...new Set(events.flatMap((event) => event.assetIds))].sort(),
      [...assetIds].sort(),
    );
    const updated = await store.synchronize(scope);
    assert.equal(
      updated.count({ manualTagLinks: { some: { tag: { normalizedName: 'after' } } } }),
      2,
    );
    await db.eagleManualTag.delete({ where: { id: tag.id } });
    assert.equal(
      (await store.synchronize(scope)).count({ manualTagLinks: { some: { tagId: tag.id } } }),
      0,
    );
  } finally {
    await db.eagleManualTag.deleteMany({ where: { id: tag.id } });
  }
});
