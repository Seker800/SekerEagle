import assert from 'node:assert/strict';
import { log } from 'node:console';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { rankSmartFolderMatches } from '../../apps/api/dist/eagle/eagle-smart-folder-ranking.js';
import {
  runSmartFolderBuildStep,
  reconcileSmartFolderSpaces,
} from '../../apps/worker/dist/smart-folder-build.js';
import { matchSmartFoldersForEmbedding } from '../../packages/library-persistence/dist/index.js';

const name = `sekereagle-semantic-test-${randomUUID()}`;
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${cmd}: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
let started = false,
  client;
const vector = (axis = 0) => Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
const intent = (text = '海边日落', breadth = 'BALANCED') => ({
  version: 2,
  conditions: [],
  semantic: { text, breadth },
});
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
    const result = spawnSync('docker', [
      'exec',
      name,
      'pg_isready',
      '-U',
      'sekereagle_test',
      '-d',
      'sekereagle_test',
    ]);
    if (result.status === 0) break;
    if (i === 99) throw new Error('Temporary database unavailable');
    await delay(100);
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
  client = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const ownerId = randomUUID(),
    otherOwner = randomUUID();
  await client.user.createMany({
    data: [ownerId, otherOwner].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'test-only',
    })),
  });
  await client.eagleProcessingSetting.createMany({
    data: [ownerId, otherOwner].flatMap((ownerId) =>
      ['MATERIAL', 'PHOTO'].map((libraryMode) => ({ ownerId, libraryMode, mode: 'ALWAYS' })),
    ),
  });
  const spaceId = 'qwen3-vl-embedding-2b-1024-v1';
  await client.eagleEmbeddingSpace.create({
    data: {
      id: spaceId,
      model: 'Qwen/Qwen3-VL-Embedding-2B',
      revision: 'test',
      dimensions: 1024,
      instructionVersion: 'image-retrieval-v1',
      preprocessingVersion: 'preview-webp-v1',
      normalized: true,
      isCurrent: true,
    },
  });
  async function asset(
    id,
    { owner = ownerId, mode = 'PHOTO', axis = 0, private: isPrivate = false } = {},
  ) {
    await client.eagleAsset.create({
      data: {
        id,
        ownerId: owner,
        libraryMode: mode,
        originalName: `${id}.jpg`,
        displayName: id,
        normalizedDisplayName: id,
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 42,
        mediaRevision: 1,
        originalObjectKey: `users/${owner}/assets/${id}/original.jpg`,
        isPrivate,
      },
    });
    return embedding(id, owner, mode, axis);
  }
  async function embedding(
    id,
    owner = ownerId,
    mode = 'PHOTO',
    axis = 0,
    revision = 1,
    space = spaceId,
  ) {
    await client.eagleAssetEmbedding.updateMany({
      where: { ownerId: owner, libraryMode: mode, assetId: id, isCurrent: true },
      data: { isCurrent: false, status: 'SUPERSEDED' },
    });
    const record = await client.eagleAssetEmbedding.create({
      data: {
        ownerId: owner,
        libraryMode: mode,
        assetId: id,
        assetRevision: revision,
        spaceId: space,
        status: 'READY',
        isCurrent: true,
      },
    });
    await client.$executeRaw(
      Prisma.sql`UPDATE "EagleAssetEmbedding" SET embedding=${`[${vector(axis).join(',')}]`}::vector WHERE id=${record.id}`,
    );
    return record;
  }
  // More than one build batch and more than one browse page; all matching photos must be retained.
  for (let i = 0; i < 503; i++) await asset(`photo-${String(i).padStart(4, '0')}`);
  await asset('private-match', { private: true });
  await asset('other-owner', { owner: otherOwner });
  await asset('material-only', { mode: 'MATERIAL' });
  await asset('non-match', { axis: 1 });
  const service = new EagleService(client, undefined, 'PHOTO');
  const folder = await service.createSmartFolder(ownerId, { name: '海边', query: intent() });
  const infer = {
    calls: 0,
    async run() {
      this.calls++;
      return { embedding: vector() };
    },
  };
  const step = () => runSmartFolderBuildStep(client, spaceId, infer.run.bind(infer));
  // The application and database can have different clocks. A completed batch must
  // remain immediately claimable rather than wait for the application's wall clock.
  const actualNow = Date.now;
  Date.now = () => actualNow() + 60_000;
  try {
    await step();
  } finally {
    Date.now = actualNow;
  }
  const [claimable] =
    await client.$queryRaw`SELECT "availableAt"<=now() AS ready FROM "EagleSmartFolderSemanticSnapshot" WHERE "folderId"=${folder.id}`;
  assert.equal(
    claimable.ready,
    true,
    'successful batches must be immediately claimable by the database clock',
  );
  let state = (await service.listSmartFolders(ownerId))[0].semanticState;
  assert.equal(state.status, 'BUILDING');
  assert.equal(
    (await client.eagleSmartFolderSemanticSnapshot.findUnique({ where: { id: state.id } }))
      .scannedCount,
    500,
  );
  assert.ok(!('scannedCount' in state), 'public status must not expose private indexing counts');
  assert.equal(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 100 })).items.length,
    0,
  );
  // Arrives behind the durable cursor during the first build: publication must add it anyway.
  const during = await asset('aaa-during-build');
  await client.$transaction((tx) =>
    matchSmartFoldersForEmbedding(tx, { ownerId, libraryMode: 'PHOTO' }, during.id),
  );
  await step();
  assert.equal(infer.calls, 1, 'query vector must persist across build steps');
  state = (await service.listSmartFolders(ownerId))[0].semanticState;
  assert.equal(state.status, 'READY');
  assert.equal(
    await client.eagleSmartFolderSemanticMatch.count({ where: { snapshotId: state.id } }),
    505,
  );
  let cursor,
    ids = [];
  do {
    const page = await service.listAssets(ownerId, {
      smartFolderId: folder.id,
      limit: 100,
      cursor,
    });
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 504);
  assert.equal(new Set(ids).size, 504);
  assert.ok(!ids.includes('private-match'));
  assert.ok(!ids.includes('material-only'));
  assert.ok(!ids.includes('other-owner'));
  assert.equal(infer.calls, 1, 'folder browsing must not call model inference');
  await assert.rejects(
    service.listAssets(otherOwner, { smartFolderId: folder.id, limit: 10 }),
    /不存在/,
  );
  await assert.rejects(
    new EagleService(client, undefined, 'MATERIAL').listAssets(ownerId, {
      smartFolderId: folder.id,
      limit: 10,
    }),
    /不存在/,
  );
  const ranked1 = await service.listAssets(ownerId, {
    smartFolderId: folder.id,
    smartFolderOrder: 'RELEVANCE',
    limit: 100,
  });
  const ranked2 = await service.listAssets(ownerId, {
    smartFolderId: folder.id,
    smartFolderOrder: 'RELEVANCE',
    limit: 100,
    cursor: ranked1.nextCursor,
  });
  assert.equal(ranked1.items.length, 100);
  assert.equal(ranked2.items.length, 100);
  assert.equal(new Set([...ranked1.items, ...ranked2.items].map((row) => row.id)).size, 200);
  await assert.rejects(
    service.listAssets(ownerId, {
      smartFolderId: folder.id,
      smartFolderOrder: 'RELEVANCE',
      limit: 10,
      cursor: 'invalid',
    }),
    /游标无效/,
  );
  // Dynamic ordinary rules do not trigger a new vector build.
  const withRating = {
    ...intent(),
    conditions: [
      {
        id: 'c',
        match: 'ALL',
        result: 'MATCH',
        rules: [{ id: 'r', field: 'RATING', operator: 'GTE', value: '4' }],
      },
    ],
  };
  let updated = await service.updateSmartFolder(ownerId, folder.id, {
    rowVersion: folder.rowVersion,
    query: withRating,
  });
  assert.equal(await client.eagleSmartFolderSemanticSnapshot.count(), 1);
  await assert.rejects(
    service.listAssets(ownerId, {
      smartFolderId: folder.id,
      smartFolderOrder: 'RELEVANCE',
      limit: 100,
      cursor: ranked1.nextCursor,
    }),
    /游标无效/,
  );
  assert.equal(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items.length,
    0,
  );
  await client.eagleAsset.update({ where: { id: 'photo-0000' }, data: { rating: 5 } });
  assert.equal(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items[0].id,
    'photo-0000',
  );
  // Replacement immediately invalidates cached memberships even before the new vector exists.
  await client.eagleAsset.update({ where: { id: 'photo-0000' }, data: { mediaRevision: 2 } });
  assert.equal(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items.length,
    0,
  );
  const replacement = await embedding('photo-0000', ownerId, 'PHOTO', 0, 2);
  await client.$transaction((tx) =>
    matchSmartFoldersForEmbedding(tx, { ownerId, libraryMode: 'PHOTO' }, replacement.id),
  );
  assert.equal(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items.length,
    1,
  );
  // Failed replacement intent preserves the active snapshot and exposes a retryable state.
  updated = await service.updateSmartFolder(ownerId, folder.id, {
    rowVersion: updated.rowVersion,
    query: intent('雨天'),
  });
  await runSmartFolderBuildStep(client, spaceId, async () => {
    throw new Error('offline');
  });
  state = (await service.listSmartFolders(ownerId))[0].semanticState;
  assert.equal(state.status, 'PENDING');
  assert.equal(state.hasResults, true);
  assert.ok(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items.length > 0,
  );
  let pending = await client.eagleSmartFolderSemanticSnapshot.findFirst({
    where: { folderId: folder.id, isActive: false },
  });
  await client.eagleSmartFolderSemanticSnapshot.update({
    where: { id: pending.id },
    data: { attempts: 4, availableAt: new Date(0) },
  });
  await runSmartFolderBuildStep(client, spaceId, async () => {
    throw new Error('offline');
  });
  assert.equal((await service.listSmartFolders(ownerId))[0].semanticState.status, 'FAILED');
  updated = await service.updateSmartFolder(ownerId, folder.id, {
    rowVersion: updated.rowVersion,
    query: intent('雨天'),
  });
  await step();
  await step();
  assert.equal((await service.listSmartFolders(ownerId))[0].semanticState.status, 'READY');
  assert.equal(
    await client.eagleSmartFolderSemanticSnapshot.count(),
    1,
    'old snapshots are cleaned after atomic activation',
  );
  // Privacy and trash are evaluated when browsing, never frozen in the cache.
  await client.eagleAsset.update({ where: { id: 'photo-0001' }, data: { isPrivate: true } });
  assert.ok(
    !(await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 100 })).items.some(
      (row) => row.id === 'photo-0001',
    ),
  );
  const total = await client.eagleSmartFolderSemanticMatch.count();
  // Composite foreign keys reject cross-owner/mode links at the database boundary.
  const active = await client.eagleSmartFolderSemanticSnapshot.findFirstOrThrow({
    where: { folderId: folder.id, isActive: true },
  });
  const foreign = await client.eagleAssetEmbedding.findFirstOrThrow({
    where: { ownerId: otherOwner },
  });
  await assert.rejects(
    client.eagleSmartFolderSemanticMatch.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        snapshotId: active.id,
        embeddingId: foreign.id,
        similarity: 0.9,
      },
    }),
  );
  assert.equal(await client.eagleSmartFolderSemanticMatch.count(), total);
  // A lease stolen while inference is in flight cannot publish or activate its result.
  updated = await service.updateSmartFolder(ownerId, folder.id, {
    rowVersion: updated.rowVersion,
    query: intent('城市'),
  });
  await runSmartFolderBuildStep(client, spaceId, async () => {
    await client.eagleSmartFolderSemanticSnapshot.updateMany({
      where: { folderId: folder.id, isActive: false },
      data: { leaseToken: 'stolen' },
    });
    return { embedding: vector() };
  });
  assert.equal((await service.listSmartFolders(ownerId))[0].semanticState.hasResults, true);
  // Removing the semantic condition removes the durable cache and returns to ordinary rules.
  updated = await service.updateSmartFolder(ownerId, folder.id, {
    rowVersion: updated.rowVersion,
    query: { version: 2, conditions: [] },
  });
  assert.equal(await client.eagleSmartFolderSemanticSnapshot.count(), 0);
  assert.equal(await client.eagleSmartFolderSemanticMatch.count(), 0);
  assert.equal(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items.length,
    0,
  );
  // Explicitly activated new embedding spaces queue rebuilds without deleting old results.
  await service.updateSmartFolder(ownerId, folder.id, {
    rowVersion: updated.rowVersion,
    query: intent(),
  });
  await step();
  await step();
  await client.eagleEmbeddingSpace.update({ where: { id: spaceId }, data: { isCurrent: false } });
  await client.eagleEmbeddingSpace.create({
    data: {
      id: 'test-new-space',
      model: 'Qwen/Qwen3-VL-Embedding-2B',
      revision: 'test-new',
      dimensions: 1024,
      instructionVersion: 'image-retrieval-v1',
      preprocessingVersion: 'preview-webp-v1',
      normalized: true,
      isCurrent: true,
    },
  });
  await reconcileSmartFolderSpaces(client, 'test-new-space');
  assert.equal(await client.eagleSmartFolderSemanticSnapshot.count(), 2);
  assert.ok(
    (await service.listSmartFolders(ownerId))[0].semanticState.hasResults,
    JSON.stringify(
      await client.eagleSmartFolderSemanticSnapshot.findMany({
        select: {
          id: true,
          text: true,
          status: true,
          isActive: true,
          spaceId: true,
          scannedCount: true,
          errorCode: true,
        },
      }),
    ),
  );
  await runSmartFolderBuildStep(client, 'test-new-space', infer.run.bind(infer));
  assert.equal((await service.listSmartFolders(ownerId))[0].semanticState.status, 'BUILDING');
  assert.ok(
    (await service.listAssets(ownerId, { smartFolderId: folder.id, limit: 10 })).items.length > 0,
    'old-space results stay browsable while new image vectors are missing',
  );
  // Mixed parent trees keep ordinary-only child members after cached relevance hits.
  await client.eagleAsset.update({ where: { id: 'non-match' }, data: { rating: 5 } });
  await client.eagleAsset.createMany({
    data: Array.from({ length: 105 }, (_, index) => ({
      id: `ordinary-only-${index}`,
      ownerId,
      libraryMode: 'PHOTO',
      originalName: `${index}.jpg`,
      displayName: `${index}`,
      normalizedDisplayName: `${index}`,
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 42,
      mediaRevision: 1,
      rating: 5,
      originalObjectKey: `users/${ownerId}/ordinary/${index}.jpg`,
    })),
  });
  const child = await service.createSmartFolder(ownerId, {
    name: '高评分',
    parentId: folder.id,
    query: {
      version: 2,
      conditions: [
        {
          id: 'c',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'r', field: 'RATING', operator: 'GTE', value: '4' }],
        },
      ],
    },
  });
  async function collect(order) {
    let next,
      result = [];
    do {
      const page = await service.listAssets(ownerId, {
        smartFolderId: folder.id,
        limit: 100,
        cursor: next,
        ...(order ? { smartFolderOrder: order } : {}),
      });
      result.push(...page.items.map((row) => row.id));
      next = page.nextCursor;
    } while (next);
    return result;
  }
  const byDate = await collect(),
    byRelevance = await collect('RELEVANCE');
  assert.deepEqual([...byRelevance].sort(), [...byDate].sort());
  assert.equal(byRelevance.at(-1), 'non-match');
  const scope = { ownerId, libraryMode: 'PHOTO' };
  assert.deepEqual(
    await rankSmartFolderMatches(client, scope, [folder.id], undefined, 10, false, false, []),
    [],
  );
  assert.equal(
    (
      await rankSmartFolderMatches(client, scope, [folder.id], undefined, 10, true, false, [
        'private-match',
      ])
    )[0].assetId,
    'private-match',
  );
  await client.eagleAsset.update({ where: { id: 'photo-0002' }, data: { deletedAt: new Date() } });
  assert.equal(
    (
      await rankSmartFolderMatches(client, scope, [folder.id], undefined, 10, false, true, [
        'photo-0002',
      ])
    )[0].assetId,
    'photo-0002',
  );
  await service.deleteSmartFolder(ownerId, child.id);
  await service.deleteSmartFolder(ownerId, folder.id);
  assert.equal(await client.eagleSmartFolderSemanticSnapshot.count(), 0);
  assert.equal(await client.eagleSmartFolderSemanticMatch.count(), 0);
  log(
    'Semantic smart folders: migration, full build, cached paging, increment, rules, privacy, owner/mode, replacement, retries, leases and cleanup passed.',
  );
} finally {
  await client?.$disconnect();
  if (started) run('docker', ['stop', name]);
}
