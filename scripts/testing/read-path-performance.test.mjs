import { observePrismaAdapter } from './database-query-probe.mjs';
import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { PhotoStatisticsService } from '../../apps/api/dist/photos/photo-statistics.service.js';
import { readPeopleCountPage } from '../../apps/api/dist/photos/photo-person-count-page.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';

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
