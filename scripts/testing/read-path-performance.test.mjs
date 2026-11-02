import { observePrismaAdapter } from './database-query-probe.mjs';
import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { PhotoStatisticsService } from '../../apps/api/dist/photos/photo-statistics.service.js';
import { readPeopleCountPage } from '../../apps/api/dist/photos/photo-person-count-page.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { EagleImageSearchService } from '../../apps/api/dist/eagle/eagle-image-search.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({
  adapter: observePrismaAdapter((e) => queries.push(e.query)),
  log: [{ emit: 'event', level: 'query' }],
});
const ownerId = randomUUID();
const prefix = `${ownerId}-`;
const assetId = (n) => `${prefix}asset-${String(n).padStart(5, '0')}`;
let queries = [];
const searchSpaces = [];

before(async () => {
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  await db.$executeRaw`
    INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","updatedAt",rating,"mediaRevision")
    SELECT ${prefix}||'asset-'||lpad(n::text,5,'0'),${ownerId},'PHOTO','synthetic.jpg','synthetic','synthetic','image/jpeg','jpeg',42,${prefix}||n,now(),CASE WHEN n>=59800 THEN 5 ELSE 1 END,1 FROM generate_series(0,59999) n`;
  await db.$executeRaw`ANALYZE "EagleAsset"`;
  await db.$executeRaw`
    INSERT INTO "EaglePhotoMetadata" ("assetId","ownerId","libraryMode","assetRevision","processorVersion","cameraModel","lensModel","capturedAt","capturedLocal")
    SELECT id,${ownerId},'PHOTO',1,'synthetic','Camera','Lens','2025-01-01'::timestamp,'2025-01-01T12:00:00' FROM "EagleAsset" WHERE "ownerId"=${ownerId}`;
  await db.$executeRaw`
    INSERT INTO "EaglePhotoPerson" (id,"ownerId","libraryMode",name,prototype,"modelVersion","updatedAt")
    SELECT ${prefix}||'person-'||lpad(n::text,4,'0'),${ownerId},'PHOTO',CASE WHEN n=0 THEN 'Named' END,(ARRAY[1.0]::float8[]||array_fill(0::float8,ARRAY[127])),'synthetic',now() FROM generate_series(0,999) n`;
  await db.$executeRaw`ANALYZE "EaglePhotoPerson"`;
  await db.$executeRaw`
    INSERT INTO "EaglePhotoFace" (id,"ownerId","libraryMode","assetId","assetRevision","modelVersion","personId",box,confidence,embedding)
    SELECT ${prefix}||'face-'||lpad(n::text,5,'0'),${ownerId},'PHOTO',${prefix}||'asset-'||lpad(n::text,5,'0'),1,'synthetic',${prefix}||'person-'||lpad((n%1000)::text,4,'0'),ARRAY[0,0,1,1]::float8[],n::float8/10000,(ARRAY[1.0]::float8[]||array_fill(0::float8,ARRAY[127])) FROM generate_series(0,9999) n`;
  await db.$executeRaw`ANALYZE "EagleAsset"`;
  await db.$executeRaw`ANALYZE "EaglePhotoMetadata"`;
  await db.$executeRaw`ANALYZE "EaglePhotoFace"`;
  await db.$executeRaw`ANALYZE "EaglePhotoPerson"`;
});
after(async () => {
  await db.eaglePhotoFace.deleteMany({ where: { ownerId } });
  await db.eaglePhotoMetadata.deleteMany({ where: { ownerId } });
  await db.eagleSmartFolderSemanticMatch.deleteMany({ where: { ownerId } });
  await db.eagleAssetEmbedding.deleteMany({ where: { ownerId } });
  await db.eagleAsset.deleteMany({ where: { ownerId } });
  await db.eaglePhotoPerson.deleteMany({ where: { ownerId } });
  await db.eagleSmartFolder.deleteMany({ where: { ownerId } });
  await db.user.delete({ where: { id: ownerId } });
  await db.eagleEmbeddingSpace.deleteMany({ where: { id: { in: searchSpaces } } });
  await db.$disconnect();
});
function nodes(plan) {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}
async function explain(query) {
  const [row] = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,VERBOSE,FORMAT JSON) ${query}`,
  );
  return row['QUERY PLAN'][0];
}
test('date-ordered empty searches finish in one database round trip across sixty thousand photos', async () => {
  const ranker = new EagleImageSearchService(db, {}, 'PHOTO');
  queries = [];
  const started = performance.now();
  const result = await ranker.rankPage(
    ownerId,
    'no-synthetic-result-8e260cc8',
    { status: 'UNAVAILABLE', spaceId: 'synthetic' },
    undefined,
    40,
    false,
    false,
    undefined,
    'CAPTURED_AT',
  );
  console.log(
    'empty date search',
    JSON.stringify({ ms: performance.now() - started, sql: queries.length }),
  );
  assert.deepEqual(result, []);
  assert.equal(
    queries.length,
    1,
    'no-match searches must not paginate through the entire library over SQL',
  );
});
test('sparse date searches page every match past a thousand while retaining owner, mode, private and trash boundaries', async () => {
  const match = 'sparse-date-search-8e260cc8';
  const changed = Array.from({ length: 1053 }, (_, n) => assetId(n));
  await db.eagleAsset.updateMany({
    where: { id: { in: changed } },
    data: { normalizedDisplayName: match },
  });
  await db.eagleAsset.update({ where: { id: assetId(0) }, data: { isPrivate: true } });
  await db.eagleAsset.update({ where: { id: assetId(1) }, data: { deletedAt: new Date() } });
  const ranker = new EagleImageSearchService(db, {}, 'PHOTO');
  const context = { status: 'UNAVAILABLE', spaceId: 'synthetic' };
  try {
    for (const sort of ['CAPTURED_AT', 'ADDED_AT'])
      for (const includePrivate of [false, true]) {
        const field = sort === 'CAPTURED_AT' ? 'chronologicalAt' : 'libraryAddedAt';
        const expected = await db.eagleAsset.findMany({
          where: {
            ownerId,
            libraryMode: 'PHOTO',
            deletedAt: null,
            normalizedDisplayName: match,
            ...(includePrivate ? {} : { isPrivate: false }),
          },
          orderBy: [{ [field]: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        const seen = [];
        let after;
        for (;;) {
          queries = [];
          const page = await ranker.rankPage(
            ownerId,
            match,
            context,
            after,
            40,
            includePrivate,
            false,
            undefined,
            sort,
          );
          assert.equal(queries.length, 1);
          assert.ok(page.every((row) => row.tier === 3 && row.similarity === 1));
          seen.push(...page.map((row) => row.assetId));
          assert.ok(seen.length <= expected.length, 'cursor must advance without duplicates');
          if (page.length < 40) break;
          after = page.at(-1);
        }
        assert.deepEqual(
          seen,
          expected.map((row) => row.id),
        );
        assert.ok(seen.length > 1000);
      }
    assert.deepEqual(
      await ranker.rankPage(
        randomUUID(),
        match,
        context,
        undefined,
        40,
        true,
        false,
        undefined,
        'CAPTURED_AT',
      ),
      [],
    );
    assert.deepEqual(
      await new EagleImageSearchService(db, {}, 'MATERIAL').rankPage(
        ownerId,
        match,
        context,
        undefined,
        40,
        true,
        false,
        undefined,
        'ADDED_AT',
      ),
      [],
    );
    const trash = await ranker.rankPage(
      ownerId,
      match,
      context,
      undefined,
      40,
      true,
      true,
      undefined,
      'CAPTURED_AT',
    );
    assert.deepEqual(
      trash.map((row) => row.assetId),
      [assetId(1)],
    );
  } finally {
    await db.eagleAsset.updateMany({
      where: { id: { in: changed } },
      data: { normalizedDisplayName: 'synthetic', isPrivate: false, deletedAt: null },
    });
  }
});
test('statistics compacts repeated daily facts before materializing chart inputs', async () => {
  let captured;
  const service = new PhotoStatisticsService({
    $queryRaw: (q) => {
      captured = q;
      return db.$queryRaw(q);
    },
  });
  const result = await service.get(ownerId, false, {});
  assert.equal(result.total, 60000);
  assert.deepEqual(result.cameras, [{ key: 'Camera', count: 60000 }]);
  assert.deepEqual(result.points, [{ period: '2025-01', key: 'Camera', count: 60000 }]);
  const plan = await explain(captured);
  const scoped = nodes(plan.Plan).find((n) => n['Subplan Name'] === 'CTE scoped');
  assert.ok(scoped, 'scoped chart input must have a visible measured plan');
  console.log(
    'statistics',
    JSON.stringify({ ms: plan['Execution Time'], intermediateRows: scoped['Actual Rows'] }),
  );
  assert.ok(
    scoped['Actual Rows'] <= 2,
    '60,000 identical daily facts must not be materialized 60,000 times',
  );
});
test('people pagination chooses representatives only after selecting the page', async () => {
  let captured;
  const tx = {
    $queryRaw: (strings, ...values) => {
      captured = Prisma.sql(strings, ...values);
      return db.$queryRaw(captured);
    },
  };
  const page = await readPeopleCountPage(tx, ownerId, false, undefined, 'ALL');
  assert.equal(page.rows.length, 24);
  assert.equal(page.rows[0].id, `${prefix}person-0000`);
  assert.ok(page.rows.every((row) => row.photos === 10n));
  assert.equal(page.rows[0].faceId, `${prefix}face-09000`);
  const next = await readPeopleCountPage(tx, ownerId, false, page.nextCursor, 'ALL');
  assert.equal(next.rows.length, 24);
  assert.equal(new Set([...page.rows, ...next.rows].map((r) => r.id)).size, 48);
  const plan = await explain(captured);
  const perPerson = nodes(plan.Plan).filter(
    (n) => n['Node Type'] === 'Limit' && n['Actual Loops'] > 1,
  );
  assert.ok(perPerson.length, 'representative selection must be bounded by the selected page');
  assert.ok(perPerson.every((n) => n['Actual Loops'] <= 25));
  console.log(
    'people',
    JSON.stringify({
      ms: plan['Execution Time'],
      representativeLoops: perPerson.map((n) => n['Actual Loops']),
    }),
  );
});
test('people representatives never bypass privacy, revision or distinct-photo counting', async () => {
  const personId = `${prefix}person-0000`;
  const duplicateId = `${prefix}duplicate-face`;
  const face = await db.eaglePhotoFace.findUniqueOrThrow({ where: { id: `${prefix}face-09000` } });
  await db.eaglePhotoFace.create({ data: { ...face, id: duplicateId, confidence: 1 } });
  const read = (privateAccess = false) =>
    readPeopleCountPage(db, ownerId, privateAccess, undefined, 'ALL');
  try {
    assert.equal((await read()).rows[0].photos, 10n);
    assert.equal((await read()).rows[0].faceId, duplicateId);
    await db.eagleAsset.update({ where: { id: assetId(9000) }, data: { isPrivate: true } });
    await db.eaglePhotoFace.update({
      where: { id: `${prefix}face-08000` },
      data: { assetRevision: 0 },
    });
    await db.eagleAsset.update({ where: { id: assetId(7000) }, data: { deletedAt: new Date() } });
    const visible = (await read()).rows[0];
    assert.equal(visible.photos, 7n);
    assert.equal(visible.faceId, `${prefix}face-06000`);
    assert.equal((await read(true)).rows[0].photos, 8n);
    assert.equal((await read(true)).rows[0].faceId, duplicateId);
    await db.eaglePhotoPerson.update({
      where: { id: personId },
      data: { marksAssetsPrivate: true },
    });
    assert.ok((await read()).rows.every((r) => r.id !== personId));
    await db.eaglePhotoFace.updateMany({
      where: { ownerId, personId },
      data: { isCurrent: false },
    });
    const emptyPrivate = (await read(true)).rows[0];
    assert.equal(emptyPrivate.photos, 0n);
    assert.equal(emptyPrivate.faceId, null);
    assert.deepEqual(
      (await readPeopleCountPage(db, randomUUID(), true, undefined, 'ALL')).rows,
      [],
    );
    const page = await read();
    await assert.rejects(
      readPeopleCountPage(db, ownerId, true, page.nextCursor, 'ALL'),
      /游标无效/,
    );
    await assert.rejects(readPeopleCountPage(db, ownerId, false, 'invalid', 'ALL'), /游标无效/);
    const unnamed = await readPeopleCountPage(db, ownerId, false, undefined, 'UNNAMED');
    assert.ok(unnamed.rows.every((r) => !r.named));
  } finally {
    await db.eaglePhotoFace.delete({ where: { id: duplicateId } });
    await db.eaglePhotoFace.updateMany({
      where: { ownerId, personId },
      data: { isCurrent: true, assetRevision: 1 },
    });
    await db.eaglePhotoPerson.update({
      where: { id: personId },
      data: { marksAssetsPrivate: false },
    });
    await db.eagleAsset.updateMany({
      where: { id: { in: [assetId(9000), assetId(7000)] } },
      data: { isPrivate: false, deletedAt: null },
    });
  }
});
test('sparse smart-folder filters do not repeatedly hydrate rejected candidate batches', async () => {
  const space =
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
  const folder = await db.eagleSmartFolder.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      name: 'Synthetic',
      normalizedName: 'synthetic',
      queryJson: { version: 2, conditions: [], semantic: { text: 'synthetic', breadth: 'BROAD' } },
    },
  });
  const snapshot = await db.eagleSmartFolderSemanticSnapshot.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      folderId: folder.id,
      intentKey: 'synthetic',
      text: 'synthetic',
      breadth: 'BROAD',
      threshold: 0.25,
      spaceId: space.id,
    },
  });
  const vector = `[1,${Array(1023).fill(0).join(',')}]`;
  await db.$executeRaw`UPDATE "EagleSmartFolderSemanticSnapshot" SET "queryVector"=${vector}::vector,status='READY',"isActive"=true WHERE id=${snapshot.id}`;
  await db.$executeRaw`
    INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent","updatedAt")
    SELECT ${prefix}||'embedding-'||lpad(n::text,5,'0'),${ownerId},'PHOTO',${prefix}||'asset-'||lpad(n::text,5,'0'),1,${space.id},'READY',true,now() FROM generate_series(59000,59999) n`;
  await db.$executeRaw`
    INSERT INTO "EagleSmartFolderSemanticMatch" ("ownerId","libraryMode","snapshotId","embeddingId",similarity)
    SELECT ${ownerId},'PHOTO',${snapshot.id},${prefix}||'embedding-'||lpad(n::text,5,'0'),1-(n-59000)::float8/10000 FROM generate_series(59000,59999) n`;
  const service = new EagleService(db, undefined, 'PHOTO');
  await setImmediate();
  queries = [];
  const page = await service.listAssets(ownerId, {
    smartFolderId: folder.id,
    smartFolderOrder: 'RELEVANCE',
    rating: 5,
    limit: 10,
  });
  await setImmediate();
  const rankings = queries.filter((q) => q.includes('max(m.similarity)'));
  assert.deepEqual(
    page.items.map((r) => r.id),
    Array.from({ length: 10 }, (_, i) => assetId(59800 + i)),
  );
  console.log('smart folder', JSON.stringify({ sql: queries.length, rankings: rankings.length }));
  assert.equal(
    rankings.length,
    1,
    'a selective filter must be applied before relevance pagination, not after each 250-row batch',
  );
  const all = [...page.items.map((r) => r.id)];
  let cursor = page.nextCursor;
  while (cursor) {
    const next = await service.listAssets(ownerId, {
      smartFolderId: folder.id,
      smartFolderOrder: 'RELEVANCE',
      rating: 5,
      limit: 40,
      cursor,
    });
    all.push(...next.items.map((r) => r.id));
    cursor = next.nextCursor;
  }
  assert.deepEqual(
    all,
    Array.from({ length: 200 }, (_, i) => assetId(59800 + i)),
  );
  await assert.rejects(
    new EagleService(db, undefined, 'MATERIAL').listAssets(ownerId, {
      smartFolderId: folder.id,
      smartFolderOrder: 'RELEVANCE',
      limit: 10,
    }),
    /不存在/,
  );
  await assert.rejects(
    service.listAssets(randomUUID(), {
      smartFolderId: folder.id,
      smartFolderOrder: 'RELEVANCE',
      limit: 10,
    }),
    /不存在/,
  );
});

async function prepareRelevanceFixture() {
  let space = await db.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } });
  if (!space) {
    space = await db.eagleEmbeddingSpace.create({
      data: {
        id: randomUUID(),
        model: 'Qwen/Qwen3-VL-Embedding-2B',
        revision: randomUUID(),
        dimensions: 1024,
        normalized: true,
        instructionVersion: 'synthetic',
        preprocessingVersion: 'synthetic',
        isCurrent: true,
      },
    });
    searchSpaces.push(space.id);
  }
  const vector = `[1,${Array(1023).fill(0).join(',')}]`;
  await db.$executeRaw`INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent",embedding,"l2Norm","updatedAt")
    SELECT ${space.id}||'-'||id,${ownerId},'PHOTO',id,"mediaRevision",${space.id},'READY',true,${vector}::vector,1,now() FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND rating=5
    ON CONFLICT ("assetId","assetRevision","spaceId") DO UPDATE SET embedding=EXCLUDED.embedding,"l2Norm"=1`;
  const ranker = new EagleImageSearchService(db, {}, 'PHOTO');
  const context = { status: 'READY', spaceId: space.id, vector };
  return { ranker, context };
}
function observeHydration(hydrated, beforeRead = async () => {}) {
  return new Proxy(db, {
    get(target, key) {
      if (key === 'eagleAsset')
        return new Proxy(target.eagleAsset, {
          get(model, method) {
            if (method === 'findMany')
              return async (args) => {
                await beforeRead(args);
                const rows = await model.findMany(args);
                hydrated.push(rows.length);
                return rows;
              };
            return Reflect.get(model, method);
          },
        });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
test('interactive relevance search hydrates only the requested page plus its continuation sentinel', async () => {
  const { ranker, context } = await prepareRelevanceFixture();
  const hydrated = [];
  const traced = observeHydration(hydrated);
  const service = new EagleService(
    traced,
    { prepare: async () => context, rankPage: ranker.rankPage.bind(ranker) },
    'PHOTO',
  );
  const first = await service.listAssets(ownerId, {
    search: 'unmatched-text',
    rating: 5,
    limit: 40,
  });
  assert.equal(first.items.length, 40);
  assert.ok(first.nextCursor);
  console.log('relevance page hydration', JSON.stringify({ requested: 40, hydrated }));
  assert.deepEqual(
    hydrated,
    [41],
    'filtered ranking must not hydrate 250 full cards for a 40-card page',
  );
});

test('relevance search fills concurrent candidate losses and keeps every remaining page complete', async () => {
  const { ranker, context } = await prepareRelevanceFixture();
  const expected = await db.eagleAsset.findMany({
    where: { ownerId, libraryMode: 'PHOTO', rating: 5, deletedAt: null, isPrivate: false },
    orderBy: [{ libraryAddedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  const removed = expected[0].id,
    hydrated = [];
  let changed = false;
  const traced = observeHydration(hydrated, async () => {
    if (!changed) {
      changed = true;
      await db.eagleAsset.update({ where: { id: removed }, data: { rating: 1 } });
    }
  });
  const service = new EagleService(
    traced,
    { prepare: async () => context, rankPage: ranker.rankPage.bind(ranker) },
    'PHOTO',
  );
  try {
    const first = await service.listAssets(ownerId, {
      search: 'unmatched-text',
      rating: 5,
      limit: 40,
    });
    assert.equal(first.items.length, 40);
    assert.deepEqual(
      hydrated,
      [40, 1],
      'a stale candidate should refill only the missing sentinel',
    );
    const seen = first.items.map((row) => row.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await service.listAssets(ownerId, {
        search: 'unmatched-text',
        rating: 5,
        limit: 40,
        cursor,
      });
      seen.push(...page.items.map((row) => row.id));
      assert.ok(seen.length < expected.length);
      cursor = page.nextCursor;
    }
    assert.deepEqual(
      seen,
      expected.slice(1).map((row) => row.id),
    );
    assert.ok(hydrated.every((count) => count <= 41));
  } finally {
    await db.eagleAsset.update({ where: { id: removed }, data: { rating: 5 } });
  }
});

test('capture-date smart folders and quick filters include old photographs and the end day without leaking unknown dates or scope', async () => {
  const service = new EagleService(db, undefined, 'PHOTO');
  const name = `${prefix}capture-date`;
  const cases = [
    ['old', '2018-01-01T12:00:00Z', {}],
    ['end', '2026-06-02T23:59:59.999Z', {}],
    ['next', '2026-06-03T00:00:00Z', {}],
    ['unknown', null, {}],
    ['private', '2018-01-01T12:00:00Z', { isPrivate: true }],
    ['trash', '2018-01-01T12:00:00Z', { deletedAt: new Date() }],
    ['material', '2018-01-01T12:00:00Z', { libraryMode: 'MATERIAL' }],
  ];
  const ids = [];
  for (const [suffix, capturedAt, extra] of cases) {
    const id = `${name}-${suffix}`;
    ids.push(id);
    await db.eagleAsset.create({
      data: {
        id,
        ownerId,
        libraryMode: 'PHOTO',
        originalName: name,
        displayName: name,
        normalizedDisplayName: name,
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 42,
        originalObjectKey: id,
        ...extra,
        ...(extra.libraryMode === 'MATERIAL'
          ? {}
          : {
              photoMetadata: {
                create: {
                  assetRevision: 0,
                  processorVersion: 'capture-date-test',
                  capturedAt: capturedAt ? new Date(capturedAt) : null,
                },
              },
            }),
      },
    });
  }
  const condition = (field, operator, value) => ({
    id: field,
    match: 'ALL',
    result: 'MATCH',
    rules: [{ id: field, field, operator, value }],
  });
  const ordinary = { version: 2, conditions: [condition('NAME', 'EQUALS', name)] };
  const capture = {
    version: 2,
    conditions: [condition('CAPTURED_AT', 'BETWEEN', ['2016-01-01', '2026-06-02'])],
  };
  const combined = { ...ordinary, conditions: [...ordinary.conditions, ...capture.conditions] };
  const folder = await service.createSmartFolder(ownerId, { name, query: ordinary });
  try {
    const page = await service.listAssets(ownerId, {
      smartFolderId: folder.id,
      rules: JSON.stringify(capture),
      limit: 40,
    });
    assert.deepEqual(new Set(page.items.map((a) => a.id)), new Set([`${name}-old`, `${name}-end`]));
    assert.deepEqual(await service.countAssets(ownerId, combined), { count: 2 });
    assert.deepEqual(await service.countAssets(ownerId, combined, true), { count: 3 });
    const saved = await service.createSmartFolder(ownerId, {
      name: `${name}-saved`,
      query: combined,
    });
    const savedPage = await service.listAssets(ownerId, { smartFolderId: saved.id, limit: 40 });
    assert.deepEqual(
      new Set(savedPage.items.map((a) => a.id)),
      new Set(page.items.map((a) => a.id)),
    );
    await assert.rejects(
      () => new EagleService(db, undefined, 'MATERIAL').countAssets(ownerId, combined),
      /摄影筛选/,
    );
    await assert.rejects(
      () => service.listAssets(randomUUID(), { smartFolderId: folder.id, limit: 40 }),
      /智能文件夹不存在/,
    );
    await db.eagleSmartFolder.delete({ where: { id: saved.id } });
  } finally {
    await db.eagleSmartFolder.delete({ where: { id: folder.id } });
    await db.eagleAsset.deleteMany({ where: { id: { in: ids } } });
  }
});
