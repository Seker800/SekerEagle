import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { log } from 'node:console';
import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { requireApi } from './api-dependencies.mjs';
import {
  LibraryReadStore,
  createLibraryReadPool,
} from '../../apps/api/dist/eagle/eagle-memory-store.js';
import { createLibraryReaderServer } from '../../apps/api/dist/eagle/eagle-memory-server.js';
import {
  DEFAULT_LIBRARY_READ_ACTIONS,
  libraryReadObserver,
} from '../../apps/api/dist/eagle/eagle-memory-observability.js';
import { photoStatisticsFactFieldsSql } from '../../apps/api/dist/photos/photo-statistics-query.js';
import { readResidentPhotoStatistics } from '../../apps/api/dist/photos/photo-statistics-memory.js';
import { readResidentPhotoFacets } from '../../apps/api/dist/photos/photo-facets-memory.js';
import { residentPersonCounts } from '../../apps/api/dist/photos/photo-people-memory.js';
import {
  readResidentSmartFolderPage,
  withResidentSemanticGraph,
} from '../../apps/api/dist/eagle/eagle-memory-semantic-store.js';
import { COLOR_PALETTE_VERSION, hexColorLab } from '../../packages/library-core/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const rowCount = Number(process.env.READER_BENCHMARK_ROWS ?? 60000);
assert.ok(Number.isSafeInteger(rowCount) && rowCount > 0);
const allActions = 'page,count,statistics,facets,peopleCounts,smartFolderPage,colorPage';

test('indexed photo pages and real authenticated HTTP A/B retain identical results and report complete API latency', async () => {
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  const ownerId = randomUUID(),
    other = randomUUID();
  let app, server, pool, spaceId;
  const saved = { ...process.env };
  try {
    const indices =
      await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename='EagleAsset' AND indexname IN ('EagleAsset_photo_active_order_idx','EagleAsset_photo_public_active_order_idx')`;
    assert.equal(
      indices.length,
      2,
      'both private-visible and public chronological order indices are required',
    );
    await db.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${ownerId}@example.invalid`,
          passwordHash: 'synthetic-only',
          role: 'ADMIN',
        },
        {
          id: other,
          email: `${other}@example.invalid`,
          passwordHash: 'synthetic-only',
          role: 'USER',
        },
      ],
    });
    for (const mode of ['PHOTO', 'MATERIAL'])
      await db.$executeRaw(Prisma.sql`
      INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize",width,height,rating,"isPrivate","originalObjectKey","chronologicalAt","libraryAddedAt","updatedAt")
      SELECT ${ownerId}||'-'||${mode}||'-'||n,${ownerId},${mode}::"LibraryMode",'IMG_'||n,'IMG_'||n,'img_'||n,'image/jpeg','jpg',20000000,6000,4000,
        CASE WHEN n%100=0 THEN 4 ELSE NULL END,n%5=0,'synthetic/'||${mode}||'/'||n,
        timestamp '2020-01-01'+n*interval '1 hour',timestamp '2026-01-01'+n*interval '1 second',now()
      FROM generate_series(1,${rowCount}::int) n`);
    await db.$executeRaw(Prisma.sql`INSERT INTO "EaglePhotoMetadata" ("assetId","ownerId","libraryMode","assetRevision","processorVersion","cameraModel","lensModel","capturedAt","capturedLocal","analyzedAt")
      SELECT id,"ownerId","libraryMode",0,'synthetic','Camera '||(length(id)%4),'Lens '||(length(id)%8),"chronologicalAt",to_char("chronologicalAt",'YYYY-MM-DD"T"HH24:MI:SS'),now()
      FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO'`);
    const [labL, labA, labB] = hexColorLab('#ffffff');
    await db.$executeRaw(Prisma.sql`INSERT INTO "EagleAssetColorAnalysis" (id,"ownerId","libraryMode","assetId","assetRevision","processorVersion",status,"isCurrent","updatedAt")
      SELECT 'color-'||id,"ownerId","libraryMode",id,0,${COLOR_PALETTE_VERSION},'COMPLETED',true,now() FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO'`);
    await db.$executeRaw(Prisma.sql`INSERT INTO "EagleAssetColorSwatch" ("ownerId","libraryMode","analysisId",rank,hex,weight,"labL","labA","labB")
      SELECT "ownerId","libraryMode",id,0,'#ffffff',1,${labL},${labA},${labB} FROM "EagleAssetColorAnalysis" WHERE "ownerId"=${ownerId}`);
    const personId = randomUUID();
    await db.eaglePhotoPerson.create({
      data: {
        id: personId,
        ownerId,
        libraryMode: 'PHOTO',
        name: 'Synthetic',
        prototype: [1, ...Array(127).fill(0)],
        modelVersion: 'synthetic',
      },
    });
    await db.$executeRaw(Prisma.sql`INSERT INTO "EaglePhotoFace" (id,"ownerId","libraryMode","assetId","assetRevision","personId","modelVersion",box,embedding,confidence)
      SELECT 'face-'||id,"ownerId","libraryMode",id,0,${personId},'synthetic',ARRAY[0,0,10,10]::double precision[],array_fill(0.0::double precision,ARRAY[128]),0.9
      FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' LIMIT 6000`);
    spaceId = randomUUID();
    const folderId = randomUUID(),
      snapshotId = randomUUID();
    await db.eagleEmbeddingSpace.create({
      data: {
        id: spaceId,
        model: 'synthetic',
        revision: spaceId,
        dimensions: 1024,
        instructionVersion: 'synthetic',
        preprocessingVersion: 'synthetic',
        normalized: true,
      },
    });
    const semantic = { text: 'synthetic', breadth: 'BALANCED' };
    await db.eagleSmartFolder.create({
      data: {
        id: folderId,
        ownerId,
        libraryMode: 'PHOTO',
        name: 'Synthetic',
        normalizedName: 'synthetic',
        queryJson: { version: 2, conditions: [], semantic },
      },
    });
    await db.$executeRaw(Prisma.sql`INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent","updatedAt")
      SELECT 'embedding-'||id,"ownerId","libraryMode",id,0,${spaceId},'READY',true,now() FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' LIMIT 6000`);
    await db.eagleSmartFolderSemanticSnapshot.create({
      data: {
        id: snapshotId,
        ownerId,
        libraryMode: 'PHOTO',
        folderId,
        intentKey: createHash('sha256')
          .update(JSON.stringify([semantic.text, semantic.breadth, spaceId]))
          .digest('hex'),
        ...semantic,
        threshold: 0,
        spaceId,
        isActive: false,
        status: 'READY',
      },
    });
    await db.$executeRaw(
      Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot" SET "isActive"=true,"queryVector"=${JSON.stringify([1, ...Array(1023).fill(0)])}::vector WHERE id=${snapshotId}`,
    );
    await db.$executeRaw(Prisma.sql`INSERT INTO "EagleSmartFolderSemanticMatch" ("ownerId","libraryMode","snapshotId","embeddingId",similarity)
      SELECT "ownerId","libraryMode",${snapshotId},id,0.9 FROM "EagleAssetEmbedding" WHERE "ownerId"=${ownerId} AND "spaceId"=${spaceId}`);
    await db.$executeRawUnsafe('ANALYZE "EagleAsset"');
    for (const privateVisible of [false, true]) {
      const result = await db.$queryRaw(
        Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND "deletedAt" IS NULL ${privateVisible ? Prisma.empty : Prisma.sql`AND NOT "isPrivate"`} ORDER BY "chronologicalAt" DESC,id DESC LIMIT 41`,
      );
      const explain = result[0]['QUERY PLAN'][0];
      const scans = [];
      function visit(node) {
        assert.ok(
          !['Sort', 'Incremental Sort'].includes(node['Node Type']),
          'default photo page must not scan then sort',
        );
        if (node['Index Name'])
          scans.push({
            index: node['Index Name'],
            rows: node['Actual Rows'],
            loops: node['Actual Loops'],
          });
        node.Plans?.forEach(visit);
      }
      visit(explain.Plan);
      assert.ok(
        scans.some((scan) => scan.index.includes('photo_') && scan.rows * scan.loops <= 410),
      );
      log(
        JSON.stringify({
          fixture: 'photo chronological index',
          privateVisible,
          selectionMs: explain['Execution Time'],
          scans,
        }),
      );
    }
    pool = createLibraryReadPool(process.env.DATABASE_URL);
    const store = new LibraryReadStore(pool, photoStatisticsFactFieldsSql());
    for (const libraryMode of ['PHOTO', 'MATERIAL'])
      await store.synchronize({ ownerId, libraryMode });
    server = createLibraryReaderServer(store, 'synthetic-reader', 2097152, {
      statistics: (index, privacy, query) =>
        readResidentPhotoStatistics(pool, index, privacy, query),
      facets: (index, privacy) => readResidentPhotoFacets(pool, index, privacy),
      peopleCounts: residentPersonCounts,
      semanticQuery: (index, ids, read) =>
        withResidentSemanticGraph(index, ids, (graph, view) => read(graph.context, view)),
      smartFolderPage: readResidentSmartFolderPage,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      CANONICAL_ORIGIN: 'http://localhost:3000',
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      ACCESS_TOKEN_TTL_SECONDS: '3600',
      REFRESH_TOKEN_TTL_SECONDS: '3600',
      S3_PUBLIC_ENDPOINT: 'http://localhost:3000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'synthetic-only',
      S3_SECRET_ACCESS_KEY: 'synthetic-only',
      EAGLE_READER_URL: `http://127.0.0.1:${server.address().port}`,
      EAGLE_READER_TOKEN: 'synthetic-reader',
    });
    const { NestFactory } = requireApi('@nestjs/core');
    const { ValidationPipe } = requireApi('@nestjs/common');
    const cookieParser = requireApi('cookie-parser');
    const { AppModule } = await import('../../apps/api/dist/app.module.js');
    const { SessionTokenService } =
      await import('../../apps/api/dist/auth/session-token.service.js');
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const session = await app
      .get(SessionTokenService)
      .createSession(await db.user.findUniqueOrThrow({ where: { id: ownerId } }));
    const cookie = `sekereagle_access=${session.accessToken}`;
    const diagnostics = '/api/admin/eagle-processing/reader-metrics';
    assert.equal((await fetch(origin + diagnostics)).status, 401);
    const ordinary = await app
      .get(SessionTokenService)
      .createSession(await db.user.findUniqueOrThrow({ where: { id: other } }));
    assert.equal(
      (
        await fetch(origin + diagnostics, {
          headers: { cookie: `sekereagle_access=${ordinary.accessToken}` },
        })
      ).status,
      403,
    );
    const rating = {
      version: 2,
      conditions: [
        {
          id: 'rating',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'r', field: 'RATING', operator: 'GTE', value: '1' }],
        },
      ],
    };
    const cases = [
      ['photo-page', '/api/photos/assets?limit=40'],
      ['material-page', '/api/eagle/assets?limit=40'],
      ['count-all', '/api/photos/assets/filter-count', { query: { version: 2, conditions: [] } }],
      ['count-rating', '/api/photos/assets/filter-count', { query: rating }],
      ['statistics', '/api/photos/photography/statistics?grain=month&groupBy=camera'],
      ['facets', '/api/photos/photography/facets'],
      ['people', '/api/photos/photography/people?view=ALL&projection=cards'],
      ['semantic', `/api/photos/assets?limit=40&smartFolderId=${folderId}`],
      ['color', '/api/photos/assets?limit=40&color=%23ffffff'],
    ];
    const invoke = async (path, body) => {
      const start = performance.now();
      const response = await fetch(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          cookie,
          origin: 'http://localhost:3000',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(response.status, body ? 201 : 200, JSON.stringify(data));
      return { ms: performance.now() - start, data };
    };
    const percentile = (values, fraction) =>
      [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
    for (const [label, path, body] of cases) {
      const samples = { sql: [], reader: [], selected: [] };
      let baseline;
      for (let n = 0; n < 12; n++)
        for (const mode of n % 2 ? ['selected', 'reader', 'sql'] : ['sql', 'reader', 'selected']) {
          process.env.EAGLE_READER_ACTIONS =
            mode === 'sql' ? '' : mode === 'reader' ? allActions : DEFAULT_LIBRARY_READ_ACTIONS;
          const result = await invoke(path, body);
          if (!baseline) baseline = result.data;
          else assert.deepEqual(result.data, baseline, `${label} SQL/reader must agree`);
          if (n >= 2) samples[mode].push(result.ms);
        }
      log(
        JSON.stringify({
          fixture: 'authenticated HTTP reader A/B',
          label,
          resourcesPerMode: rowCount,
          samples: 10,
          sqlP50Ms: percentile(samples.sql, 0.5),
          sqlP95Ms: percentile(samples.sql, 0.95),
          readerP50Ms: percentile(samples.reader, 0.5),
          readerP95Ms: percentile(samples.reader, 0.95),
          selectedP50Ms: percentile(samples.selected, 0.5),
          selectedP95Ms: percentile(samples.selected, 0.95),
          scope:
            'warm local synthetic, includes auth, HTTP, hydration; excludes media GET and browser rendering',
        }),
      );
    }
    process.env.EAGLE_READER_ACTIONS = DEFAULT_LIBRARY_READ_ACTIONS;
    const before = libraryReadObserver.snapshot().actions.facets.attempts;
    const started = performance.now();
    const writer = db.eagleAsset.updateMany({
      where: { ownerId, libraryMode: 'PHOTO', rating: null },
      data: { rating: 2 },
    });
    const [, duringWrite] = await Promise.all([writer, invoke('/api/photos/photography/facets')]);
    await store.synchronize({ ownerId, libraryMode: 'PHOTO' });
    process.env.EAGLE_READER_ACTIONS = allActions;
    const afterWrite = await invoke('/api/photos/photography/facets');
    assert.deepEqual(
      afterWrite.data,
      duringWrite.data,
      'rating writes do not change photography facets',
    );
    assert.equal(libraryReadObserver.snapshot().actions.facets.attempts, before + 2);
    log(
      JSON.stringify({
        fixture: 'reader during and after concurrent bulk write',
        duringWriteApiMs: duringWrite.ms,
        afterWriteApiMs: afterWrite.ms,
        writeAndCatchupMs: performance.now() - started,
      }),
    );
    const diagnostic = await fetch(origin + diagnostics, { headers: { cookie } });
    assert.equal(diagnostic.status, 200);
    const metrics = await diagnostic.json();
    assert.ok(!JSON.stringify(metrics).includes(ownerId));
    log(JSON.stringify({ fixture: 'per-action reader metrics', metrics }));
  } finally {
    if (app) await app.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    if (pool) await pool.end();
    await db.eagleAsset.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
    await db.eaglePhotoPerson.deleteMany({ where: { ownerId } });
    await db.eagleSmartFolder.deleteMany({ where: { ownerId } });
    if (spaceId) await db.eagleEmbeddingSpace.deleteMany({ where: { id: spaceId } });
    await db.eagleLibraryReadState.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, other] } } });
    await db.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
