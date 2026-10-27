import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import console from 'node:console';
import { setInterval, clearInterval } from 'node:timers';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { selectScheduledMediaCandidates } from '../../apps/worker/dist/scheduled-media-candidates.js';
import {
  createRemoteMediaServer,
  RemoteMediaClient,
  RemoteMediaUnavailableError,
} from '../../apps/worker/dist/remote-media.js';
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
let probeTimer,
  worker,
  stderr = '',
  events = '',
  releaseNas,
  blocked = false,
  staleBlocked = false,
  releaseStale;
const staleGate = new Promise((resolve) => {
  releaseStale = resolve;
});
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
  console.error(
    'Isolated synthetic queue at timeout',
    await db.eagleAssetProcessingJob.findMany({
      where: { ownerId },
      select: { kind: true, status: true, attempts: true, lastError: true },
    }),
  );
  console.error('Isolated worker events', events.slice(-6000));
  throw new Error('Compute worker timeout: ' + stderr.slice(-2000));
}
try {
  const space =
    (await db.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } })) ??
    (await db.eagleEmbeddingSpace.create({
      data: {
        id: 'synthetic-compute-space',
        model: 'Synthetic/Compute-2B',
        revision: 'fixed-test-revision',
        dimensions: 1024,
        instructionVersion: 'synthetic-v1',
        preprocessingVersion: 'synthetic-v1',
        normalized: true,
        isCurrent: true,
      },
    }));
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
  let syntheticVideo;
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
        if (req.url.includes('stale-pyramid')) {
          staleBlocked = true;
          await staleGate;
        }
        if (req.url.includes('blocked-color')) {
          blocked = true;
          await gate;
        }
        const body = req.url.includes('remote-video') ? syntheticVideo : pixels;
        if (!body) throw new Error('SYNTHETIC_SOURCE_NOT_READY');
        res.setHeader(
          'content-type',
          req.url.includes('remote-video') ? 'video/mp4' : 'image/jpeg',
        );
        res.setHeader('content-length', body.length);
        res.end(body);
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
    mediaUrl = await listen(
      createRemoteMediaServer('media-test-token', 1, false, 'libx264', [
        'image',
        'pyramid',
        'video',
      ]),
    );
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
      operations: ['image', 'pyramid', 'video'],
      maxConcurrent: 1,
      reserveInteractive: 0,
      enabled: false,
      verified: true,
    },
  ]);
  await probeFleet(fleet);
  // Match the real coordinator's periodic probes: health leases expire during live-policy tests.
  let probing = false;
  probeTimer = setInterval(async () => {
    if (probing) return;
    probing = true;
    try {
      await probeFleet(fleet);
    } finally {
      probing = false;
    }
  }, 5000);
  const coordinatorUrl = await listen(
    createCoordinator({ fleet, executionToken: 'synthetic-only', adminToken: 'management-token' }),
  );
  const failedUrl = await listen(
    createServer((req, res) => {
      req.resume();
      res.writeHead(500);
      res.end('{}');
    }),
  );
  const failedFleet = new Fleet({ directory: join(directory, 'error-fleet'), contract });
  await failedFleet.initialize([
    {
      id: 'failed',
      name: 'Failure fixture',
      url: failedUrl,
      token: 'test-failed-token',
      accelerator: 'cpu',
      operations: ['image'],
      maxConcurrent: 1,
      reserveInteractive: 0,
      verified: true,
      enabled: true,
    },
  ]);
  failedFleet.markHealth('failed', {
    status: 'ready',
    capacity: { inFlight: 0 },
    protocol: 'sekereagle-media-v1',
    imageEncoding: 'SEI1',
    operations: ['image'],
  });
  const failedCoordinator = await listen(
    createCoordinator({
      fleet: failedFleet,
      executionToken: 'synthetic-only',
      adminToken: 'management-token',
    }),
  );
  await assert.rejects(
    new RemoteMediaClient(failedCoordinator, 'synthetic-only').image(
      (async function* () {
        yield pixels;
      })(),
      {
        assetMimeType: 'image/jpeg',
        sourceMimeType: 'image/jpeg',
        kind: 'GENERATE_RENDITIONS',
        mode: 'MATERIAL',
        detailsOnly: false,
        verifiesOriginalHash: true,
      },
    ),
    (error) => error instanceof Error && !(error instanceof RemoteMediaUnavailableError),
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
  await db.eagleAssetProcessingJob.update({
    where: { id: remoteJob.id },
    data: { availableAt: new Date(Date.now() + 86400000) },
  });
  const env = {
    ...process.env,
    S3_ENDPOINT: sourceUrl,
    S3_BUCKET: 'sekereagle-test',
    S3_ACCESS_KEY_ID: 'synthetic-only',
    S3_SECRET_ACCESS_KEY: 'synthetic-only',
    EAGLE_PROCESSING_JOB_KINDS:
      'GENERATE_RENDITIONS,GENERATE_EMBEDDING,EXTRACT_COLOR_PALETTE,GENERATE_IMAGE_PYRAMID',
    EAGLE_VIDEO_TRANSCODING_ENABLED: 'true',
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
  const policy = async (nodeId, enabled, operations) => {
    const response = await fetch(coordinatorUrl + '/admin/policy', {
      method: 'POST',
      headers: { authorization: 'Bearer management-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: fleet.snapshot().revision,
        nodeId,
        enabled,
        concurrency: nodeId === 'mac-vector' ? 2 : 1,
        operations: operations ?? [nodeId === 'mac-vector' ? 'embedding' : 'image'],
        durationSeconds: 60,
        reason: 'Synthetic live policy regression',
      }),
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
  };
  worker = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (b) => {
    events += b.toString();
  });
  worker.stderr.on('data', (b) => {
    stderr += b.toString();
  });
  await waitFor(async () => blocked);
  // Delegate only future claims: the already held NAS color job keeps its lease and slot.
  await db.eagleAssetProcessingJob.update({
    where: { id: remoteJob.id },
    data: { availableAt: new Date(0) },
  });
  await policy('mac-media', true);
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
  const waitRevision = async (revision) =>
    waitFor(async () =>
      (await db.eagleProcessingWorkerHeartbeat.findMany({ select: { capabilities: true } })).some(
        (row) => row.capabilities?.compute?.revision === revision,
      ),
    );
  await policy('mac-vector', false);
  await policy('mac-media', false);
  await waitRevision(3);
  assert.equal(fleet.acquire('embedding', false), null);
  assert.equal(fleet.acquire('image', false), null);
  await policy('mac-vector', true);
  await policy('mac-media', true);
  await waitRevision(5);
  assert.equal(worker.exitCode, null, 'Hot policy changes must not restart the worker');
  // Exercise real streamed artifact publication through the original owner/version/lease worker.
  const moviePath = join(directory, 'synthetic-video.mp4');
  await promisify(execFile)(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=96x64:rate=10',
      '-t',
      '0.6',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      moviePath,
    ],
    { timeout: 30000 },
  );
  syntheticVideo = await readFile(moviePath);
  const remoteVideo = await asset('remote-video', 'video/mp4');
  await db.eagleAsset.update({
    where: { id: remoteVideo.id },
    data: {
      format: 'mp4',
      sha256: createHash('sha256').update(syntheticVideo).digest('hex'),
      byteSize: syntheticVideo.length,
    },
  });
  const remoteVideoJob = await job(remoteVideo, 'GENERATE_RENDITIONS', 'INTERACTIVE');
  const remotePyramid = await asset('remote-pyramid');
  const remotePyramidJob = await job(remotePyramid, 'GENERATE_IMAGE_PYRAMID', 'BACKGROUND');
  await policy('mac-media', true, ['image', 'pyramid', 'video']);
  await waitFor(
    async () =>
      (await db.eagleAssetProcessingJob.count({
        where: { id: { in: [remoteVideoJob.id, remotePyramidJob.id] }, status: 'COMPLETED' },
      })) === 2,
  );
  assert.equal(
    (await db.eagleAssetProcessingJob.findUnique({ where: { id: localJob.id } })).status,
    'PROCESSING',
    'Artifacts must complete while the original NAS job remains blocked',
  );
  assert.ok(
    await db.eagleAssetRendition.findFirst({
      where: {
        assetId: remoteVideo.id,
        kind: 'PREVIEW',
        status: 'READY',
        mimeType: 'video/mp4',
        ownerId,
        libraryMode: 'MATERIAL',
      },
    }),
  );
  assert.ok(
    await db.eagleImagePyramid.findFirst({
      where: { assetId: remotePyramid.id, status: 'READY', ownerId, libraryMode: 'MATERIAL' },
    }),
  );
  // A superseded renderer must never replace the newer executor's READY publication.
  const stale = await asset('stale-pyramid');
  const staleJob = await job(stale, 'GENERATE_IMAGE_PYRAMID', 'BACKGROUND');
  await waitFor(async () => staleBlocked);
  await db.$transaction(async (transaction) => {
    await transaction.eagleAssetProcessingJob.update({
      where: { id: staleJob.id },
      data: { status: 'COMPLETED', completedAt: new Date(), leaseVersion: { increment: 1 } },
    });
    await transaction.eagleImagePyramid.create({
      data: {
        ownerId,
        libraryMode: 'MATERIAL',
        assetId: stale.id,
        revision: 1,
        processorVersion: 'v1',
        status: 'READY',
        storagePrefix: `synthetic-newer-${stale.id}`,
        width: 96,
        height: 64,
        maxLevel: 7,
        tileCount: 123,
        completedAt: new Date(),
      },
    });
  });
  releaseStale();
  await waitFor(
    async () =>
      events.includes(`"jobId":"${staleJob.id}"`) &&
      events
        .split('\n')
        .some((line) => line.includes('eagle_media_job_completed') && line.includes(staleJob.id)),
  );
  const retained = await db.eagleImagePyramid.findFirst({ where: { assetId: stale.id } });
  assert.equal(retained.status, 'READY');
  assert.equal(retained.tileCount, 123);
  assert.equal(retained.storagePrefix, `synthetic-newer-${stale.id}`);
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
    'Compute fleet real DB/HTTP acceptance passed: remote image and vector finish while NAS is blocked; image-only excludes video; verified video and pyramid publish remotely under the original lease; live policies drain/restore without restart; node errors remain bounded; graceful drain publishes the remaining job.\n',
  );
} finally {
  clearInterval(probeTimer);
  releaseNas();
  releaseStale();
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
