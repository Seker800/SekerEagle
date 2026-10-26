import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { selectScheduledMediaCandidates } from '../../apps/worker/dist/scheduled-media-candidates.js';
import { createRemoteMediaServer } from '../../apps/worker/dist/remote-media.js';
import { Fleet } from '../../apps/compute-coordinator/fleet.mjs';
import { createCoordinator, probeFleet } from '../../apps/compute-coordinator/server.mjs';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient(),
  ownerId = randomUUID(),
  directory = await mkdtemp(join(tmpdir(), 'eagle-compute-worker-'));
const servers = [];
let worker,
  stderr = '',
  releaseNas,
  blocked = false;
const gate = new Promise((resolve) => {
  releaseNas = resolve;
});
const pixels = await sharp({
  create: { width: 96, height: 64, channels: 3, background: '#b49260' },
})
  .jpeg()
  .toBuffer();
const digest = createHash('sha256').update(pixels).digest('hex');
async function listen(server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function waitFor(check) {
  for (let i = 0; i < 240; i++) {
    if (await check()) return;
    await delay(250);
  }
  throw new Error('Compute worker timeout: ' + stderr.slice(-2000));
}
try {
  const space = await db.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } });
  assert.ok(space);
  await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
  });
  await db.eagleProcessingSetting.create({
    data: { ownerId, libraryMode: 'MATERIAL', mode: 'ALWAYS' },
  });
  const contract = { model: space.model, revision: space.revision, dimensions: 1024 };
  let embeddingCalls = 0,
    puts = 0;
  const sourceServer = createServer((req, res) => {
    void (async () => {
      if (req.url === '/healthz') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ ...contract, status: 'ready', metal: true, capacity: { inFlight: 0 } }),
        );
        return;
      }
      if (req.url === '/v1/embeddings/image') {
        for await (const chunk of req) void chunk;
        embeddingCalls++;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ ...contract, normalized: true, embedding: [1, ...Array(1023).fill(0)] }),
        );
        return;
      }
      if (req.method === 'GET') {
        if (req.url.includes('blocked-color')) {
          blocked = true;
          await gate;
        }
        res.setHeader('content-type', 'image/jpeg');
        res.setHeader('content-length', pixels.length);
        res.end(pixels);
        return;
      }
      if (req.method === 'PUT') {
        for await (const chunk of req) void chunk;
        puts++;
        res.writeHead(200, { etag: '"synthetic"' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    })().catch(() => {
      res.destroy();
    });
  });
  const sourceUrl = await listen(sourceServer),
    mediaUrl = await listen(createRemoteMediaServer('media-test-token', 1));
  const fleet = new Fleet({ directory, contract });
  await fleet.initialize([
    {
      id: 'mac-vector',
      hostId: 'test-host',
      hostMaxConcurrent: 3,
      name: 'Synthetic Metal',
      url: sourceUrl,
      token: 'backend-token',
      accelerator: 'metal',
      operations: ['embedding'],
      maxConcurrent: 2,
      reserveInteractive: 0,
      enabled: true,
      verified: true,
    },
    {
      id: 'mac-media',
      hostId: 'test-host',
      hostMaxConcurrent: 3,
      name: 'Synthetic Media',
      url: mediaUrl,
      token: 'media-test-token',
      accelerator: 'cpu',
      operations: ['image'],
      maxConcurrent: 1,
      reserveInteractive: 0,
      enabled: true,
      verified: true,
    },
  ]);
  await probeFleet(fleet);
  const coordinatorUrl = await listen(
    createCoordinator({ fleet, executionToken: 'synthetic-only', adminToken: 'management-token' }),
  );
  const asset = async (name, mimeType = 'image/jpeg') =>
    db.eagleAsset.create({
      data: {
        ownerId,
        libraryMode: 'MATERIAL',
        originalName: name + '.jpg',
        displayName: name,
        normalizedDisplayName: name,
        mimeType,
        format: 'jpeg',
        byteSize: pixels.length,
        sha256: digest,
        width: 96,
        height: 64,
        mediaRevision: 1,
        originalObjectKey: `users/${ownerId}/assets/${name}/original.jpg`,
        libraryAddedAt: new Date('2200-01-01Z'),
        chronologicalAt: new Date('2200-01-01Z'),
      },
    });
  const rendition = async (a, kind, key) =>
    db.eagleAssetRendition.create({
      data: {
        ownerId,
        libraryMode: 'MATERIAL',
        assetId: a.id,
        revision: 1,
        kind,
        variant: 'default',
        status: 'READY',
        mimeType: 'image/jpeg',
        byteSize: pixels.length,
        storageKey: `users/${ownerId}/assets/${key}`,
        width: 96,
        height: 64,
      },
    });
  const job = async (a, kind, lane) =>
    db.eagleAssetProcessingJob.create({
      data: {
        ownerId,
        libraryMode: 'MATERIAL',
        assetId: a.id,
        assetRevision: 1,
        kind,
        lane,
        processorVersion: kind === 'GENERATE_RENDITIONS' ? 'rendition-v2' : 'v1',
        availableAt: new Date(0),
      },
    });
  const local = await asset('local-color');
  await rendition(local, 'THUMBNAIL', 'blocked-color.jpg');
  const localJob = await job(local, 'EXTRACT_COLOR_PALETTE', 'BACKGROUND');
  const remote = await asset('remote-image');
  const remoteJob = await job(remote, 'GENERATE_RENDITIONS', 'INTERACTIVE');
  const vector = await asset('vector');
  await rendition(vector, 'PREVIEW', 'vector-preview.jpg');
  const vectorJob = await job(vector, 'GENERATE_EMBEDDING', 'BACKGROUND');
  const video = await asset('video', 'video/mp4');
  const videoJob = await job(video, 'GENERATE_RENDITIONS', 'INTERACTIVE');
  const candidates = await selectScheduledMediaCandidates(
    db,
    { where: { lane: 'INTERACTIVE', kind: { in: ['GENERATE_RENDITIONS'] } }, take: 50 },
    true,
    false,
    { resource: 'REMOTE_MEDIA' },
  );
  assert.ok(candidates.some((j) => j.id === remoteJob.id));
  assert.ok(!candidates.some((j) => j.id === videoJob.id));
  await db.eagleAssetProcessingJob.update({
    where: { id: videoJob.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  const env = {
    ...process.env,
    S3_ENDPOINT: sourceUrl,
    S3_BUCKET: 'sekereagle-test',
    S3_ACCESS_KEY_ID: 'synthetic-only',
    S3_SECRET_ACCESS_KEY: 'synthetic-only',
    EAGLE_PROCESSING_JOB_KINDS: 'GENERATE_RENDITIONS,GENERATE_EMBEDDING,EXTRACT_COLOR_PALETTE',
    EAGLE_BACKGROUND_PROCESSING_ENABLED: 'true',
    EAGLE_INTERACTIVE_CONCURRENCY: '1',
    MLX_EMBEDDING_URL: coordinatorUrl,
    MLX_EMBEDDING_TOKEN: 'synthetic-only',
    MLX_EMBEDDING_MODEL: space.model,
    MLX_EMBEDDING_REVISION: space.revision,
    MLX_EMBEDDING_SPACE_ID: space.id,
  };
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: env.S3_BUCKET,
  });
  worker = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let events = '';
  worker.stdout.on('data', (b) => {
    events += b.toString();
  });
  worker.stderr.on('data', (b) => {
    stderr += b.toString();
  });
  await waitFor(
    async () =>
      blocked &&
      (await db.eagleAssetProcessingJob.count({
        where: { id: { in: [remoteJob.id, vectorJob.id] }, status: 'COMPLETED' },
      })) === 2,
  );
  assert.equal(
    (await db.eagleAssetProcessingJob.findUnique({ where: { id: localJob.id } })).status,
    'PROCESSING',
  );
  assert.ok(embeddingCalls > 0);
  assert.ok(puts >= 3);
  assert.ok(fleet.snapshot().nodes.find((n) => n.id === 'mac-media').completed >= 1);
  assert.match(events, /"resource":"REMOTE_MEDIA"/);
  const published = await db.eagleAssetRendition.findMany({
    where: { assetId: remote.id, status: 'READY' },
  });
  assert.equal(published.length, 3);
  const exit = once(worker, 'exit');
  worker.kill('SIGTERM');
  releaseNas();
  const [code] = await exit;
  assert.equal(code, 0, stderr);
  assert.equal(
    (await db.eagleAssetProcessingJob.findUnique({ where: { id: localJob.id } })).status,
    'COMPLETED',
  );
  assert.equal(await db.eagleAssetProcessingJob.count({ where: { ownerId, status: 'FAILED' } }), 0);
  process.stdout.write(
    'Compute fleet real DB/HTTP acceptance passed: remote image and vector finish while NAS is blocked; video stays local; graceful drain publishes the remaining job.\n',
  );
} finally {
  releaseNas();
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await once(worker, 'exit');
  }
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
