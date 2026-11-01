import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { mediaCompletion } from '../../packages/library-core/dist/index.js';
import { matchSmartFoldersForEmbedding } from '../../packages/library-persistence/dist/index.js';
import { EmbeddingProcessor } from '../../apps/worker/dist/embedding-job.js';
import {
  publishEmbedding,
  publishStoredEmbedding,
} from '../../apps/worker/dist/embedding-publication.js';
import {
  createTopEmbeddingSuggestion,
  activateEmbeddingSuggestionGeneration,
} from '../../apps/worker/dist/embedding-suggestions.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let events = [];
prisma.$on('query', (event) => events.push(event));
const ownerId = randomUUID();
const scope = { ownerId, libraryMode: 'PHOTO' };
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const vectorText = `[${vector.join(',')}]`;
const identity = {
  id: 'qwen3-vl-embedding-2b-1024-v1',
  model: 'Qwen/Qwen3-VL-Embedding-2B',
  revision: '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda',
  dimensions: 1024,
  instructionVersion: 'image-retrieval-v1',
  preprocessingVersion: 'preview-webp-v1',
  normalized: true,
};
let createdSpace = false;
const suggest = (tx, owner, mode, assetId, embeddingId) =>
  createTopEmbeddingSuggestion(tx, owner, mode, assetId, embeddingId, 0.3);

before(async () => {
  const space = await prisma.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } });
  if (space) for (const key of Object.keys(identity)) identity[key] = space[key];
  else {
    await prisma.eagleEmbeddingSpace.create({ data: { ...identity, isCurrent: true } });
    createdSpace = true;
  }
  await prisma.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  // Nonempty derived work: 16 semantic folder snapshots and 64 semantic prototypes.
  for (let i = 0; i < 16; i++) {
    const folder = await prisma.eagleSmartFolder.create({
      data: {
        ...scope,
        name: `synthetic-${i}`,
        normalizedName: `synthetic-${i}`,
        queryJson: { version: 2, conditions: [] },
      },
    });
    const snapshot = await prisma.eagleSmartFolderSemanticSnapshot.create({
      data: {
        ...scope,
        folderId: folder.id,
        intentKey: 'synthetic',
        text: 'synthetic',
        breadth: 'BALANCED',
        threshold: 0.2,
        spaceId: identity.id,
        isActive: false,
        status: 'PENDING',
      },
    });
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "EagleSmartFolderSemanticSnapshot" SET "queryVector"=${vectorText}::vector, "isActive"=true, status='READY' WHERE id=${snapshot.id}`,
    );
  }
  for (let i = 0; i < 8; i++) {
    const tag = await prisma.eagleManualTag.create({
      data: { ...scope, name: `synthetic-${i}`, normalizedName: `synthetic-${i}` },
    });
    const snapshot = await prisma.eagleTagPrototypeSnapshot.create({
      data: {
        ...scope,
        tagId: tag.id,
        spaceId: identity.id,
        version: 1,
        generationId: randomUUID(),
        status: 'ACTIVE',
        isCurrent: true,
        sourceAssetCount: 8,
        sourceSetDigest: 'synthetic',
        algorithm: 'synthetic',
        algorithmVersion: 'v1',
        algorithmParams: {},
      },
    });
    await prisma.eagleManualTagSemanticConfig.create({
      data: {
        ...scope,
        tagId: tag.id,
        recommendationEnabled: true,
        currentSnapshotId: snapshot.id,
      },
    });
    for (let rank = 0; rank < 8; rank++)
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO "EagleTagPrototype" ("ownerId", "libraryMode", "snapshotId", rank, embedding, "memberCount", weight, "meanDistance", "p95Distance", "representativeAssetIds") VALUES (${ownerId}, 'PHOTO', ${snapshot.id}, ${rank}, ${vectorText}::vector, 1, 1, 0, 0, ARRAY[]::text[])`,
      );
  }
});
after(async () => {
  await prisma.eagleVectorTagSuggestion.deleteMany({ where: { ownerId } });
  await prisma.eagleAsset.deleteMany({ where: { ownerId } });
  await prisma.eagleManualTagSemanticConfig.deleteMany({ where: { ownerId } });
  await prisma.eagleTagPrototypeSnapshot.deleteMany({ where: { ownerId } });
  await prisma.eagleManualTag.deleteMany({ where: { ownerId } });
  await prisma.eagleSmartFolder.deleteMany({ where: { ownerId } });
  await prisma.user.delete({ where: { id: ownerId } });
  if (createdSpace) await prisma.eagleEmbeddingSpace.delete({ where: { id: identity.id } });
  await prisma.$disconnect();
});

async function fixture({ stored = false, mode = 'PHOTO' } = {}) {
  const asset = await prisma.eagleAsset.create({
    data: {
      ownerId,
      libraryMode: mode,
      originalName: 'synthetic.jpg',
      displayName: 'synthetic',
      normalizedDisplayName: 'synthetic',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 42,
      originalObjectKey: `users/${ownerId}/synthetic/${randomUUID()}.jpg`,
    },
  });
  const job = await prisma.eagleAssetProcessingJob.create({
    data: {
      ownerId,
      libraryMode: mode,
      assetId: asset.id,
      assetRevision: asset.mediaRevision,
      kind: 'GENERATE_EMBEDDING',
      status: 'PROCESSING',
      processorVersion: identity.id,
      leaseVersion: 1,
      attempts: 1,
      lockedAt: new Date(),
    },
  });
  const record = await prisma.eagleAssetEmbedding.create({
    data: {
      ownerId,
      libraryMode: mode,
      assetId: asset.id,
      assetRevision: asset.mediaRevision,
      spaceId: identity.id,
      status: 'RUNNING',
    },
  });
  if (stored)
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "EagleAssetEmbedding" SET embedding=${vectorText}::vector,"l2Norm"=1 WHERE id=${record.id}`,
    );
  return { job, record };
}
async function measured(work) {
  // Query-event delivery is asynchronous: exclude previous fixtures and include the final COMMIT.
  await delay(20);
  events = [];
  const start = performance.now();
  await work();
  const elapsedMs = performance.now() - start;
  await delay(20);
  const queries = events.map(({ query }) => query);
  return {
    elapsedMs,
    sql: queries.length,
    transactions: queries.filter((q) => q.trim().startsWith('BEGIN')).length,
    spaceUpdates: queries.filter((q) =>
      /(?:UPDATE|ON CONFLICT).*EagleEmbeddingSpace|EagleEmbeddingSpace.*ON CONFLICT/s.test(q),
    ).length,
  };
}

// Frozen W4 baseline: the original per-item model upsert and publication statements.
// Both sides use the hardened current suggestion rule for equal result semantics.
// Kept test-local for repeatable before/after SQL accounting, never used by runtime code.
async function baseline(f) {
  await prisma.eagleEmbeddingSpace.upsert({
    where: { id: identity.id },
    create: { ...identity, isCurrent: true },
    update: { ...identity, isCurrent: true },
  });
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "EagleAsset" WHERE id=${f.job.assetId} AND "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND "mediaRevision"=${f.job.assetRevision} AND "deletedAt" IS NULL AND "storageTransferredOut"=false FOR SHARE`,
      );
      await tx.eagleAssetProcessingJob.updateMany(mediaCompletion(f.job));
      await tx.eagleAssetEmbedding.updateMany({
        where: { ...scope, assetId: f.job.assetId, isCurrent: true },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      await tx.eagleAssetEmbedding.updateMany({
        where: {
          id: f.record.id,
          ...scope,
          assetId: f.job.assetId,
          assetRevision: f.job.assetRevision,
        },
        data: {
          status: 'READY',
          isCurrent: true,
          l2Norm: 1,
          errorCode: null,
          completedAt: new Date(),
        },
      });
      await tx.$executeRaw(
        Prisma.sql`UPDATE "EagleAssetEmbedding" SET embedding=${vectorText}::vector WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=${f.record.id}`,
      );
      await matchSmartFoldersForEmbedding(tx, scope, f.record.id);
      await suggest(tx, ownerId, 'PHOTO', f.job.assetId, f.record.id);
    },
    { timeout: 30_000 },
  );
}

test('W4 single and sustained ready results eliminate identity rewrites and one SQL per publication', async () => {
  const oldSingle = await fixture(),
    newSingle = await fixture();
  const singleBefore = await measured(() => baseline(oldSingle));
  const singleAfter = await measured(() =>
    publishEmbedding(prisma, newSingle.job, newSingle.record.id, vector, identity, suggest),
  );
  assert.equal(singleBefore.sql, 11);
  assert.equal(singleAfter.sql, 9);
  console.log(
    JSON.stringify({ event: 'embedding_single_cost', before: singleBefore, after: singleAfter }),
  );
  const old = [],
    current = [];
  for (let i = 0; i < 20; i++) {
    old.push(await fixture());
    current.push(await fixture());
  }
  const before = await measured(async () => {
    for (const f of old) await baseline(f);
  });
  const after = await measured(async () => {
    for (const f of current)
      await publishEmbedding(prisma, f.job, f.record.id, vector, identity, suggest);
  });
  assert.equal(before.transactions, 20);
  assert.equal(after.transactions, 20);
  assert.equal(before.spaceUpdates, 20);
  assert.equal(after.spaceUpdates, 0);
  assert.equal(before.sql - after.sql, 40);
  assert.equal(
    await prisma.eagleSmartFolderSemanticMatch.count({
      where: { ...scope, embeddingId: { in: current.map((f) => f.record.id) } },
    }),
    320,
  );
  assert.equal(
    await prisma.eagleVectorTagSuggestion.count({
      where: { ...scope, embeddingId: { in: current.map((f) => f.record.id) } },
    }),
    20,
  );
  console.log(
    JSON.stringify({
      event: 'embedding_publication_cost',
      items: 20,
      folders: 16,
      prototypes: 64,
      before,
      after,
      inferenceRequests: 0,
      s3Gets: 0,
      frontendRefreshes: 0,
    }),
  );
});

test('W4 stored activation, lease/version/model drift and atomic rollback preserve publication guards', async () => {
  for (const mode of ['PHOTO', 'MATERIAL']) {
    const f = await fixture({ stored: true, mode });
    let reads = 0,
      inferences = 0;
    const processor = new EmbeddingProcessor({
      client: prisma,
      identity,
      hasCredentials: true,
      readSource: async () => {
        reads++;
        return Buffer.alloc(0);
      },
      embedImage: async () => {
        inferences++;
        return { embedding: vector };
      },
      suggest,
    });
    assert.equal(await processor.activateStored(f.job), true);
    assert.equal(reads, 0);
    assert.equal(inferences, 0);
    assert.equal(
      (await prisma.eagleAssetEmbedding.findUniqueOrThrow({ where: { id: f.record.id } }))
        .isCurrent,
      true,
    );
  }
  for (const cause of ['lease', 'revision', 'model', 'record', 'derived-failure']) {
    const f = await fixture();
    if (cause === 'lease')
      await prisma.eagleAssetProcessingJob.update({
        where: { id: f.job.id },
        data: { leaseVersion: 2 },
      });
    if (cause === 'revision')
      await prisma.eagleAsset.update({ where: { id: f.job.assetId }, data: { mediaRevision: 2 } });
    const publish = () =>
      publishEmbedding(
        prisma,
        f.job,
        cause === 'record' ? randomUUID() : f.record.id,
        vector,
        cause === 'model' ? { ...identity, revision: 'different' } : identity,
        cause === 'derived-failure'
          ? async () => {
              throw new Error('synthetic-derived-failure');
            }
          : suggest,
      );
    if (['model', 'record', 'derived-failure'].includes(cause)) await assert.rejects(publish);
    else await publish();
    assert.equal(
      (await prisma.eagleAssetEmbedding.findUniqueOrThrow({ where: { id: f.record.id } }))
        .isCurrent,
      false,
    );
    assert.equal(
      (await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: f.job.id } })).status,
      'PROCESSING',
    );
    assert.equal(
      await prisma.eagleSmartFolderSemanticMatch.count({ where: { embeddingId: f.record.id } }),
      0,
    );
  }
});

test('W5 repeating published evidence cannot revive reviewed suggestions or retired vectors', async () => {
  const f = await fixture();
  await publishEmbedding(prisma, f.job, f.record.id, vector, identity, suggest);
  const original = await prisma.eagleVectorTagSuggestion.findFirstOrThrow({
    where: { ...scope, embeddingId: f.record.id },
  });
  await prisma.eagleVectorTagSuggestion.update({
    where: { id: original.id },
    data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByUserId: ownerId },
  });
  await prisma.$transaction((tx) => suggest(tx, ownerId, 'PHOTO', f.job.assetId, f.record.id));
  assert.equal(
    await prisma.eagleVectorTagSuggestion.count({ where: { ...scope, embeddingId: f.record.id } }),
    1,
  );
  await prisma.eagleAssetEmbedding.update({
    where: { id: f.record.id },
    data: { isCurrent: false, status: 'SUPERSEDED' },
  });
  await prisma.$transaction((tx) => suggest(tx, ownerId, 'PHOTO', f.job.assetId, f.record.id));
  assert.equal(
    await prisma.eagleVectorTagSuggestion.count({ where: { ...scope, embeddingId: f.record.id } }),
    1,
  );
});

// Test-only persistent relation: measures an optimistic lower bound, not a new runtime queue.
// A real adopted protocol would additionally need discovery, retry, task presentation and migration.
test('W5 atomic derived SQL has lower total cost than a durable follow-up lower bound', async () => {
  const tableName = `embedding_perf_intent_${randomUUID().replaceAll('-', '')}`;
  const table = Prisma.raw(`"${tableName}"`);
  await prisma.$executeRaw(Prisma.sql`CREATE TABLE ${table} (
    "embeddingId" text PRIMARY KEY, "ownerId" text NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
    "assetId" text NOT NULL, "assetRevision" int NOT NULL, "spaceId" text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING', "leaseVersion" int NOT NULL DEFAULT 0)`);
  try {
    const atomic = [],
      split = [];
    for (let i = 0; i < 20; i++) {
      atomic.push(await fixture());
      split.push(await fixture());
    }
    let atomicDerivedMs = 0;
    const inlineSuggest = async (tx, ...args) => {
      const start = performance.now();
      await suggest(tx, ...args);
      atomicDerivedMs += performance.now() - start;
    };
    const inline = await measured(async () => {
      for (const f of atomic)
        await publishEmbedding(prisma, f.job, f.record.id, vector, identity, inlineSuggest);
    });
    let coreMs = 0,
      folderMs = 0,
      suggestionMs = 0;
    const followup = await measured(async () => {
      for (const f of split) {
        const coreStart = performance.now();
        await prisma.$transaction(async (tx) => {
          // Same current-identity and asset/version guard as production; no model request.
          const active = await tx.$queryRaw(Prisma.sql`SELECT a.id FROM "EagleAsset" a
            JOIN "EagleEmbeddingSpace" s ON s.id=${identity.id} AND s."isCurrent"
              AND s.model=${identity.model} AND s.revision=${identity.revision} AND s.dimensions=${identity.dimensions}
              AND s.normalized=${identity.normalized} AND s."instructionVersion"=${identity.instructionVersion}
              AND s."preprocessingVersion"=${identity.preprocessingVersion}
            WHERE a.id=${f.job.assetId} AND a."ownerId"=${ownerId} AND a."libraryMode"='PHOTO'
              AND a."mediaRevision"=${f.job.assetRevision} AND a."deletedAt" IS NULL AND NOT a."storageTransferredOut"
            FOR SHARE OF a,s`);
          assert.equal(active.length, 1);
          assert.equal(
            (await tx.eagleAssetProcessingJob.updateMany(mediaCompletion(f.job))).count,
            1,
          );
          await tx.eagleAssetEmbedding.updateMany({
            where: { ...scope, assetId: f.job.assetId, isCurrent: true, id: { not: f.record.id } },
            data: { isCurrent: false, status: 'SUPERSEDED' },
          });
          assert.equal(
            await tx.$executeRaw(
              Prisma.sql`UPDATE "EagleAssetEmbedding" SET embedding=${vectorText}::vector,status='READY',"isCurrent"=true,"l2Norm"=1,"completedAt"=now(),"updatedAt"=now() WHERE id=${f.record.id} AND "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND "assetId"=${f.job.assetId} AND "assetRevision"=${f.job.assetRevision} AND "spaceId"=${identity.id}`,
            ),
            1,
          );
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO ${table} ("embeddingId","ownerId","libraryMode","assetId","assetRevision","spaceId") VALUES (${f.record.id},${ownerId},'PHOTO',${f.job.assetId},${f.job.assetRevision},${identity.id})`,
          );
        });
        coreMs += performance.now() - coreStart;
        await prisma.$transaction(async (tx) => {
          const claim = await tx.$queryRaw(
            Prisma.sql`UPDATE ${table} SET status='PROCESSING',"leaseVersion"="leaseVersion"+1 WHERE "embeddingId"=${f.record.id} AND status='PENDING' RETURNING "embeddingId"`,
          );
          assert.equal(claim.length, 1);
          const live = await tx.$queryRaw(Prisma.sql`SELECT e.id FROM "EagleAssetEmbedding" e
            JOIN "EagleAsset" a ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode" AND a."mediaRevision"=e."assetRevision"
            JOIN "EagleEmbeddingSpace" s ON s.id=e."spaceId" AND s."isCurrent"
            WHERE e.id=${f.record.id} AND e."ownerId"=${ownerId} AND e."libraryMode"='PHOTO'
              AND e."isCurrent" AND e.status='READY' AND s.id=${identity.id}
              AND s.model=${identity.model} AND s.revision=${identity.revision} AND s.dimensions=${identity.dimensions}
              AND s.normalized=${identity.normalized} AND s."instructionVersion"=${identity.instructionVersion}
              AND s."preprocessingVersion"=${identity.preprocessingVersion}
              AND a."deletedAt" IS NULL AND NOT a."storageTransferredOut" FOR SHARE OF a,e,s`);
          assert.equal(live.length, 1);
          let start = performance.now();
          await matchSmartFoldersForEmbedding(tx, scope, f.record.id);
          folderMs += performance.now() - start;
          start = performance.now();
          await suggest(tx, ownerId, 'PHOTO', f.job.assetId, f.record.id);
          suggestionMs += performance.now() - start;
          assert.equal(
            await tx.$executeRaw(
              Prisma.sql`UPDATE ${table} SET status='COMPLETED' WHERE "embeddingId"=${f.record.id} AND status='PROCESSING' AND "leaseVersion"=1`,
            ),
            1,
          );
        });
      }
    });
    assert.equal(inline.transactions, 20);
    assert.equal(followup.transactions, 40);
    assert.equal(followup.sql - inline.sql, 120);
    assert.equal(
      (
        await prisma.$queryRaw(
          Prisma.sql`SELECT count(*)::int AS count FROM ${table} WHERE status<>'COMPLETED'`,
        )
      )[0].count,
      0,
    );
    assert.equal(
      await prisma.eagleSmartFolderSemanticMatch.count({
        where: { ...scope, embeddingId: { in: split.map((f) => f.record.id) } },
      }),
      320,
    );
    assert.equal(
      await prisma.eagleVectorTagSuggestion.count({
        where: { ...scope, embeddingId: { in: split.map((f) => f.record.id) } },
      }),
      20,
    );
    console.log(
      JSON.stringify({
        event: 'embedding_derived_cost',
        items: 20,
        folders: 16,
        prototypes: 64,
        inline,
        followupLowerBound: followup,
        splitCoreMs: coreMs,
        splitFolderMs: folderMs,
        splitSuggestionMs: suggestionMs,
        inlineSuggestionMs: atomicDerivedMs,
        inferenceRequests: 0,
        s3Gets: 0,
        remaining: 0,
      }),
    );
  } finally {
    await prisma.$executeRaw(Prisma.sql`DROP TABLE ${table}`);
  }
});

test(
  'W4 one-slot, two-slot and tail results finish without a batch-fill wait',
  { timeout: 10_000 },
  async () => {
    for (const slots of [1, 2]) {
      const jobs = [];
      for (let i = 0; i < 5; i++) jobs.push((await fixture()).job);
      let requests = 0,
        sourceReads = 0,
        active = 0,
        peak = 0;
      const processor = new EmbeddingProcessor({
        client: prisma,
        identity,
        hasCredentials: true,
        readSource: async () => {
          sourceReads++;
          return Buffer.from('synthetic');
        },
        embedImage: async () => {
          requests++;
          active++;
          peak = Math.max(peak, active);
          await delay(10);
          active--;
          return { embedding: vector };
        },
        suggest,
      });
      let cursor = 0;
      const result = await measured(() =>
        Promise.all(
          Array.from({ length: slots }, async () => {
            while (cursor < jobs.length) {
              const job = jobs[cursor++];
              await processor.infer(job, 'image/jpeg', {});
            }
          }),
        ),
      );
      assert.equal(requests, jobs.length);
      assert.equal(sourceReads, jobs.length);
      assert.equal(result.spaceUpdates, 0);
      assert.equal(result.transactions, jobs.length + 1); // One compatible-space initialization.
      assert.equal(
        await prisma.eagleAssetProcessingJob.count({
          where: { id: { in: jobs.map((j) => j.id) }, status: 'COMPLETED' },
        }),
        jobs.length,
      );
      console.log(
        JSON.stringify({
          event: 'embedding_slot_progress',
          slots,
          peakInference: peak,
          items: jobs.length,
          requests,
          sourceReads,
          result,
        }),
      );
    }
  },
);

test('W5 staged generation cannot undo a review committed after candidate preparation', async () => {
  for (const cause of ['reviewed', 'revision', 'valid']) {
    const f = await fixture();
    await publishEmbedding(prisma, f.job, f.record.id, vector, identity, suggest);
    const original = await prisma.eagleVectorTagSuggestion.findFirstOrThrow({
      where: { ...scope, embeddingId: f.record.id },
    });
    const generationId = randomUUID();
    const staged = await prisma.eagleVectorTagSuggestion.create({
      data: {
        ...original,
        id: randomUUID(),
        generationId,
        isActive: false,
        reviewedAt: null,
        reviewedByUserId: null,
      },
    });
    if (cause === 'reviewed')
      await prisma.eagleVectorTagSuggestion.update({
        where: { id: original.id },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByUserId: ownerId },
      });
    else
      await prisma.eagleVectorTagSuggestion.update({
        where: { id: original.id },
        data: { isActive: false, invalidatedAt: new Date() },
      });
    if (cause === 'revision')
      await prisma.eagleAsset.update({ where: { id: f.job.assetId }, data: { mediaRevision: 2 } });
    const activated = await prisma.$transaction((tx) =>
      activateEmbeddingSuggestionGeneration(tx, scope, generationId),
    );
    assert.equal(activated, cause === 'valid' ? 1 : 0);
    assert.equal(
      (await prisma.eagleVectorTagSuggestion.findUniqueOrThrow({ where: { id: staged.id } }))
        .isActive,
      cause === 'valid',
    );
  }
});

test('W4 successful publication keeps the model identity locked against concurrent mutation', async () => {
  const f = await fixture();
  await publishEmbedding(prisma, f.job, f.record.id, vector, identity, async (tx, ...args) => {
    await assert.rejects(
      prisma.$transaction(async (other) => {
        await other.$executeRaw(Prisma.sql`SET LOCAL lock_timeout='50ms'`);
        await other.eagleEmbeddingSpace.update({
          where: { id: identity.id },
          data: { revision: 'synthetic-concurrent-revision' },
        });
      }),
      /lock timeout/,
    );
    await suggest(tx, ...args);
  });
  assert.equal(
    (await prisma.eagleEmbeddingSpace.findUniqueOrThrow({ where: { id: identity.id } })).revision,
    identity.revision,
  );
});

test('W5 API refresh keeps reviewed evidence rejected while allowing a genuinely new prototype snapshot', async () => {
  const { refreshUnclassifiedSuggestions } =
    await import('../../apps/api/dist/eagle/eagle-vector.persistence.js');
  const f = await fixture();
  await publishEmbedding(prisma, f.job, f.record.id, vector, identity, suggest);
  const original = await prisma.eagleVectorTagSuggestion.findFirstOrThrow({
    where: { ...scope, embeddingId: f.record.id },
  });
  await prisma.eagleVectorTagSuggestion.update({
    where: { id: original.id },
    data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByUserId: ownerId },
  });
  await prisma.eagleManualTagSemanticConfig.updateMany({
    where: { ...scope, tagId: { not: original.suggestedTagId } },
    data: { recommendationEnabled: false },
  });
  try {
    await refreshUnclassifiedSuggestions(prisma, { ...scope, assetIds: [f.job.assetId] });
    assert.equal(
      await prisma.eagleVectorTagSuggestion.count({
        where: { ...scope, embeddingId: f.record.id },
      }),
      1,
    );
    const previous = await prisma.eagleTagPrototypeSnapshot.findUniqueOrThrow({
      where: { id: original.snapshotId },
    });
    const replacement = await prisma.eagleTagPrototypeSnapshot.create({
      data: {
        ...previous,
        id: randomUUID(),
        version: 2,
        generationId: randomUUID(),
        isCurrent: false,
      },
    });
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "EagleTagPrototype" ("ownerId", "libraryMode", "snapshotId", rank, embedding, "memberCount", weight, "meanDistance", "p95Distance", "representativeAssetIds") VALUES (${ownerId},'PHOTO',${replacement.id},0,${vectorText}::vector,1,1,0,0,ARRAY[]::text[])`,
    );
    await prisma.eagleTagPrototypeSnapshot.update({
      where: { id: previous.id },
      data: { isCurrent: false, status: 'SUPERSEDED' },
    });
    await prisma.eagleTagPrototypeSnapshot.update({
      where: { id: replacement.id },
      data: { isCurrent: true },
    });
    await prisma.eagleManualTagSemanticConfig.update({
      where: { ownerId_tagId: { ownerId, tagId: original.suggestedTagId } },
      data: { currentSnapshotId: replacement.id },
    });
    await refreshUnclassifiedSuggestions(prisma, { ...scope, assetIds: [f.job.assetId] });
    const renewed = await prisma.eagleVectorTagSuggestion.findMany({
      where: { ...scope, embeddingId: f.record.id, status: 'PENDING', isActive: true },
    });
    assert.equal(renewed.length, 1);
    assert.equal(renewed[0].snapshotId, replacement.id);
  } finally {
    await prisma.eagleManualTagSemanticConfig.updateMany({
      where: scope,
      data: { recommendationEnabled: true },
    });
  }
});
