import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import assert from 'node:assert/strict';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleVectorService } from '../../apps/api/dist/eagle/eagle-vector.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

test('review score pages use ordered pending indexes with 30k synthetic suggestion rows', async () => {
  const db = new PrismaClient({
    adapter: createPrismaAdapter(),
    log: [{ emit: 'event', level: 'query' }],
  });
  const queries = [];
  db.$on('query', (event) => queries.push(event));
  const ownerId = randomUUID(),
    spaceId = randomUUID();
  try {
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic' },
    });
    await db.eagleEmbeddingSpace.create({
      data: {
        id: spaceId,
        model: 'synthetic',
        revision: spaceId,
        dimensions: 1024,
        instructionVersion: 'test',
        preprocessingVersion: 'test',
      },
    });
    for (let i = 0; i < 3; i++) {
      const tagId = `${ownerId}-tag-${i}`,
        snapshotId = `${ownerId}-snapshot-${i}`;
      await db.eagleManualTag.create({
        data: {
          id: tagId,
          ownerId,
          libraryMode: 'PHOTO',
          name: `tag-${i}`,
          normalizedName: `tag-${i}`,
        },
      });
      await db.eagleTagPrototypeSnapshot.create({
        data: {
          id: snapshotId,
          ownerId,
          libraryMode: 'PHOTO',
          tagId,
          spaceId,
          version: 1,
          generationId: spaceId,
          status: 'ACTIVE',
          isCurrent: true,
          sourceAssetCount: 1,
          sourceSetDigest: 'synthetic',
          algorithm: 'synthetic',
          algorithmVersion: 'test',
          algorithmParams: {},
        },
      });
    }
    await db.$executeRaw`
      INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","lifecycleStatus","updatedAt")
      SELECT ${ownerId}||'-asset-'||n,${ownerId},'PHOTO','synthetic.jpg','synthetic','synthetic','image/jpeg','jpeg',1,'users/'||${ownerId}||'/assets/'||n||'/original.jpg','READY',now() FROM generate_series(1,10000) n`;
    await db.$executeRaw`
      INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent","updatedAt")
      SELECT ${ownerId}||'-embedding-'||n,${ownerId},'PHOTO',${ownerId}||'-asset-'||n,1,${spaceId},'READY',true,now() FROM generate_series(1,10000) n`;
    await db.$executeRaw`
      INSERT INTO "EagleVectorTagSuggestion" (id,"ownerId","libraryMode","assetId","suggestedTagId","embeddingId","snapshotId","generationId","isActive",score,distance,"prototypeRank",status,"invalidatedAt","updatedAt")
      SELECT ${ownerId}||'-suggestion-'||n||'-'||h,${ownerId},'PHOTO',${ownerId}||'-asset-'||n,
        ${ownerId}||'-tag-'||(n%3),${ownerId}||'-embedding-'||n,${ownerId}||'-snapshot-'||(n%3),${spaceId},h<>1,CASE WHEN h=0 THEN (n%1000)/2000.0 ELSE 0.99 END,0.1,0,
        'PENDING'::"EagleVectorSuggestionStatus",CASE WHEN h=2 THEN now() ELSE NULL END,now()
      FROM generate_series(1,10000) n CROSS JOIN generate_series(0,2) h`;
    for (const table of ['EagleAsset', 'EagleAssetManualTag', 'EagleVectorTagSuggestion'])
      await db.$executeRawUnsafe(`ANALYZE "${table}"`);
    const service = new EagleVectorService(db, 'PHOTO');
    for (const [tagId, expectedIndex] of [
      [undefined, 'EagleVectorTagSuggestion_review_score_idx'],
      [`${ownerId}-tag-1`, 'EagleVectorTagSuggestion_review_tag_score_idx'],
    ]) {
      queries.length = 0;
      const start = performance.now();
      const result = await service.listSuggestions(ownerId, {
        limit: 40,
        sort: 'SCORE_DESC',
        tagId,
      });
      const elapsed = performance.now() - start;
      assert.equal(result.items.length, 40);
      assert.ok(result.nextCursor);
      const query = queries.find(
        (event) =>
          event.query.startsWith('SELECT') &&
          event.query.includes('FROM "public"."EagleVectorTagSuggestion"'),
      );
      assert.ok(query, 'capture the real Prisma page query');
      const plan = await db.$queryRawUnsafe(
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.query,
        ...JSON.parse(query.params),
      );
      const nodes = [];
      const visit = (node) => {
        nodes.push({
          type: node['Node Type'],
          index: node['Index Name'],
          rows: node['Actual Rows'],
          loops: node['Actual Loops'],
        });
        for (const child of node.Plans ?? []) visit(child);
      };
      visit(plan[0]['QUERY PLAN'][0].Plan);
      console.info(
        JSON.stringify({
          scope: tagId ? 'tag' : 'all',
          syntheticRows: 30000,
          higherScoringInactivePending: 20000,
          sharedHitBlocks: plan[0]['QUERY PLAN'][0].Plan['Shared Hit Blocks'],
          requestMs: elapsed,
          sqlMs: plan[0]['QUERY PLAN'][0]['Execution Time'],
          nodes,
        }),
      );
      assert.ok(
        !nodes.some((node) => node.type.includes('Sort')),
        'score page must not sort all pending candidates',
      );
      assert.ok(
        JSON.stringify(plan).includes(expectedIndex),
        `review page must use ${expectedIndex}`,
      );
    }
  } finally {
    await db.$disconnect();
  }
});

test('saved review stays model-independent and publishes forty items atomically in both modes', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('model offline');
  });
  const db = new PrismaClient({
    adapter: createPrismaAdapter(),
    log: [{ emit: 'event', level: 'query' }],
  });
  const queries = [];
  db.$on('query', (event) => queries.push(event.query));
  const ownerId = randomUUID(),
    spaceId = randomUUID();
  try {
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic' },
    });
    await db.eagleEmbeddingSpace.create({
      data: {
        id: spaceId,
        model: 'synthetic',
        revision: spaceId,
        dimensions: 1024,
        instructionVersion: 'test',
        preprocessingVersion: 'test',
      },
    });
    for (const mode of ['MATERIAL', 'PHOTO']) {
      const tagId = randomUUID(),
        snapshotId = randomUUID();
      await db.eagleManualTag.create({
        data: {
          id: tagId,
          ownerId,
          libraryMode: mode,
          name: mode,
          normalizedName: mode,
          marksAssetsPrivate: true,
        },
      });
      await db.eagleTagPrototypeSnapshot.create({
        data: {
          id: snapshotId,
          ownerId,
          libraryMode: mode,
          tagId,
          spaceId,
          version: 1,
          generationId: spaceId,
          status: 'ACTIVE',
          isCurrent: true,
          sourceAssetCount: 1,
          sourceSetDigest: 'synthetic',
          algorithm: 'synthetic',
          algorithmVersion: 'test',
          algorithmParams: {},
        },
      });
      await db.eagleManualTagSemanticConfig.create({
        data: {
          ownerId,
          libraryMode: mode,
          tagId,
          recommendationEnabled: true,
          currentSnapshotId: snapshotId,
        },
      });
      const ids = Array.from({ length: 43 }, () => randomUUID());
      await db.eagleAsset.createMany({
        data: ids.map((id) => ({
          id,
          ownerId,
          libraryMode: mode,
          originalName: 'test.jpg',
          displayName: 'test',
          normalizedDisplayName: 'test',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${ownerId}/${id}`,
          lifecycleStatus: 'READY',
          mediaRevision: 1,
        })),
      });
      await db.eagleAssetEmbedding.createMany({
        data: ids.map((id) => ({
          id,
          ownerId,
          libraryMode: mode,
          assetId: id,
          assetRevision: 1,
          spaceId,
          status: 'READY',
          isCurrent: true,
        })),
      });
      await db.eagleVectorTagSuggestion.createMany({
        data: ids.map((id) => ({
          id,
          ownerId,
          libraryMode: mode,
          assetId: id,
          embeddingId: id,
          suggestedTagId: tagId,
          snapshotId,
          generationId: spaceId,
          isActive: true,
          score: 0.9,
          distance: 0.1,
          prototypeRank: 0,
        })),
      });
      const service = new EagleVectorService(db, mode);
      const summary = await service.reviewSummary(ownerId, false);
      assert.deepEqual(summary, { suggestions: { unclassified: 43, pending: 43 } });
      await assert.rejects(
        service.reviewSuggestions('other-owner', [ids[0]], 'ACCEPT'),
        (error) => error.getStatus() === 404,
      );
      await assert.rejects(
        new EagleVectorService(db, mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO').reviewSuggestions(
          ownerId,
          [ids[0]],
          'ACCEPT',
        ),
        (error) => error.getStatus() === 404,
      );
      // A stale member must roll back the entire selection, including earlier valid members.
      await db.eagleAsset.update({ where: { id: ids[1] }, data: { mediaRevision: 2 } });
      await assert.rejects(
        service.reviewSuggestions(ownerId, ids.slice(0, 40), 'ACCEPT'),
        (error) => error.getStatus() === 409,
      );
      assert.equal(
        await db.eagleAssetManualTag.count({ where: { ownerId, libraryMode: mode } }),
        0,
      );
      assert.equal(
        await db.eagleVectorTagSuggestion.count({
          where: { ownerId, libraryMode: mode, status: 'ACCEPTED' },
        }),
        0,
      );
      await db.eagleAsset.update({ where: { id: ids[1] }, data: { mediaRevision: 1 } });
      await new Promise((resolve) => setImmediate(resolve));
      queries.length = 0;
      const start = performance.now();
      const result = await service.reviewSuggestions(ownerId, ids.slice(0, 40), 'ACCEPT');
      const elapsed = performance.now() - start;
      await new Promise((resolve) => setImmediate(resolve));
      const statementCount = queries.length;
      const commits = queries.filter((q) => q === 'COMMIT').length;
      assert.equal(result.items.length, 40);
      assert.equal(commits, 1);
      assert.ok(statementCount < 25, `batch must amortize SQL: ${statementCount}`);
      assert.equal(
        await db.eagleAssetManualTag.count({
          where: {
            ownerId,
            libraryMode: mode,
            assignmentProvenance: 'VECTOR_SUGGESTED_HUMAN_ACCEPTED',
            acceptedSuggestionId: { in: ids },
          },
        }),
        40,
      );
      assert.equal(
        await db.eagleAsset.count({ where: { ownerId, libraryMode: mode, isPrivate: true } }),
        40,
      );
      assert.equal(
        await db.eagleTagMemberDistance.count({
          where: { ownerId, libraryMode: mode, distance: 0.1, prototypeRank: 0 },
        }),
        40,
      );
      const again = await service.reviewSuggestions(ownerId, ids.slice(0, 40), 'ACCEPT', true);
      assert.equal(again.items.length, 40);
      await assert.rejects(
        service.reviewSuggestions(ownerId, [ids[0]], 'REJECT', true),
        (error) => error.getStatus() === 409,
      );
      const concurrent = await Promise.all([
        service.reviewSuggestions(ownerId, [ids[40]], 'ACCEPT', true),
        service.reviewSuggestions(ownerId, [ids[40]], 'ACCEPT', true),
      ]);
      assert.ok(concurrent.every((r) => r.items.length === 1));
      const rejected = await service.reviewSuggestions(ownerId, ids.slice(41), 'REJECT');
      assert.equal(rejected.items.length, 2);
      assert.deepEqual(await service.reviewSuggestions(ownerId, ids.slice(41), 'REJECT'), rejected);
      assert.equal((await service.reviewSummary(ownerId, true)).suggestions.pending, 0);
      console.info(
        JSON.stringify({
          mode,
          batchSize: 40,
          sql: statementCount,
          commits,
          s3: 0,
          modelRequests: 0,
          requestMs: elapsed,
        }),
      );
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    await db.$disconnect();
  }
});
