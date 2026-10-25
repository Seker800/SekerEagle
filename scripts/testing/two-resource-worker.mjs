import assert from 'node:assert/strict';
import { log } from 'node:console';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
const ownerId = randomUUID();
const pixels = await sharp({
  create: { width: 128, height: 96, channels: 3, background: '#a87850' },
})
  .jpeg()
  .toBuffer();
const digest = createHash('sha256').update(pixels).digest('hex');
let model = `Synthetic/2B-${ownerId}`,
  revision = '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda',
  spaceId = `parallel-${ownerId}`;
let releaseNas,
  receivedNas = false,
  worker,
  stderr = '';
const nasGate = new Promise((resolve) => {
  releaseNas = resolve;
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/healthz') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ready', model, revision, dimensions: 1024, metal: true }));
  } else if (url.pathname === '/v1/embeddings/image') {
    for await (const chunk of req) void chunk;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        model,
        revision,
        dimensions: 1024,
        normalized: true,
        embedding: [1, ...Array(1023).fill(0)],
      }),
    );
  } else if (req.method === 'GET' && url.pathname.endsWith('/original.jpg')) {
    receivedNas = true;
    await nasGate;
    res.setHeader('content-type', 'image/jpeg');
    res.end(pixels);
  } else if (req.method === 'GET' && url.pathname.endsWith('/preview.jpg')) {
    res.setHeader('content-type', 'image/jpeg');
    res.end(pixels);
  } else if (req.method === 'PUT') {
    for await (const chunk of req) void chunk;
    res.setHeader('etag', '"synthetic-only"');
    res.end();
  } else {
    res.statusCode = 404;
    res.end();
  }
});
async function waitFor(check) {
  for (let i = 0; i < 160; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Parallel worker timeout: ${stderr.slice(-1500)}`);
}
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const current = await db.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } });
  if (current) {
    model = current.model;
    revision = current.revision;
    spaceId = current.id;
  }
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  await db.eagleProcessingSetting.create({
    data: { ownerId, libraryMode: 'MATERIAL', mode: 'ALWAYS' },
  });
  const makeAsset = async (name) =>
    db.eagleAsset.create({
      data: {
        ownerId,
        libraryMode: 'MATERIAL',
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: pixels.length,
        sha256: digest,
        width: 128,
        height: 96,
        mediaRevision: 1,
        originalObjectKey: `users/${ownerId}/assets/${name}/original.jpg`,
        libraryAddedAt: new Date('2101-01-01Z'),
        chronologicalAt: new Date('2101-01-01Z'),
      },
    });
  const nas = await makeAsset('nas'),
    vector = await makeAsset('vector');
  await db.eagleAssetRendition.create({
    data: {
      ownerId,
      libraryMode: 'MATERIAL',
      assetId: vector.id,
      revision: 1,
      kind: 'PREVIEW',
      variant: 'default',
      status: 'READY',
      mimeType: 'image/jpeg',
      byteSize: pixels.length,
      storageKey: `users/${ownerId}/assets/vector/preview.jpg`,
      width: 128,
      height: 96,
    },
  });
  const nasJob = await db.eagleAssetProcessingJob.create({
    data: {
      ownerId,
      libraryMode: 'MATERIAL',
      assetId: nas.id,
      assetRevision: 1,
      kind: 'GENERATE_RENDITIONS',
      processorVersion: 'rendition-v2',
      lane: 'INTERACTIVE',
      availableAt: new Date(0),
    },
  });
  const vectorJob = await db.eagleAssetProcessingJob.create({
    data: {
      ownerId,
      libraryMode: 'MATERIAL',
      assetId: vector.id,
      assetRevision: 1,
      kind: 'GENERATE_EMBEDDING',
      lane: 'BACKGROUND',
      availableAt: new Date(0),
    },
  });
  const env = {
    ...process.env,
    S3_ENDPOINT: endpoint,
    S3_BUCKET: 'sekereagle-test',
    S3_ACCESS_KEY_ID: 'synthetic-only',
    S3_SECRET_ACCESS_KEY: 'synthetic-only',
    EAGLE_PROCESSING_JOB_KINDS: 'GENERATE_RENDITIONS,GENERATE_EMBEDDING',
    EAGLE_BACKGROUND_PROCESSING_ENABLED: 'true',
    EAGLE_INTERACTIVE_CONCURRENCY: '1',
    MLX_EMBEDDING_URL: endpoint,
    MLX_EMBEDDING_TOKEN: 'synthetic-only',
    MLX_EMBEDDING_MODEL: model,
    MLX_EMBEDDING_REVISION: revision,
    MLX_EMBEDDING_SPACE_ID: spaceId,
  };
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: endpoint,
    s3Bucket: env.S3_BUCKET,
  });
  worker = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  worker.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  await waitFor(
    async () =>
      receivedNas &&
      (await db.eagleAssetProcessingJob.findUnique({ where: { id: vectorJob.id } })).status ===
        'COMPLETED',
  );
  assert.equal(
    (await db.eagleAssetProcessingJob.findUnique({ where: { id: nasJob.id } })).status,
    'PROCESSING',
  );
  const finished = once(worker, 'exit');
  worker.kill('SIGTERM');
  releaseNas();
  await finished;
  assert.equal(
    (await db.eagleAssetProcessingJob.findUnique({ where: { id: nasJob.id } })).status,
    'COMPLETED',
  );
  log(
    'Real worker overlap passed: vector completed while NAS image input was blocked; graceful drain completed NAS work.',
  );
} finally {
  releaseNas();
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await once(worker, 'exit');
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
}
