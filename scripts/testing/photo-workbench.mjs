/* global setTimeout, clearTimeout, console */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { extname, resolve, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { JwtService } from '@nestjs/jwt';
import sharp from 'sharp';
import { createCameraFixtures } from './camera-media-fixtures.mjs';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const root = process.cwd(),
  name = `sekereagle-photo-workbench-${randomUUID().slice(0, 8)}`;
const containers = [],
  children = [],
  timers = [];
let db, gateway;
const artifacts = join(root, '.omx/artifacts');
await mkdir(artifacts, { recursive: true });
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { encoding: 'utf8', env });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}
async function container(suffix, image, args, command = []) {
  const id = `${name}-${suffix}`;
  run('docker', ['run', '--detach', '--rm', '--name', id, ...args, image, ...command]);
  containers.push(id);
  return run('docker', ['port', id, '5432']).split(':').at(-1);
}
function child(path, env, label) {
  const stream = createWriteStream(join(artifacts, `photo-workbench-${label}.log`));
  const process = spawn(globalThis.process.execPath, [path], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.pipe(stream);
  process.stderr.pipe(stream);
  children.push(process);
  return process;
}
async function cleanup() {
  for (const timer of timers) clearTimeout(timer);
  for (const child of children) child.kill('SIGTERM');
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  if (db) await db.$disconnect();
  for (const id of containers.reverse()) run('docker', ['stop', id]);
}
process.once('SIGINT', () => void cleanup().then(() => process.exit(0)));
process.once('SIGTERM', () => void cleanup().then(() => process.exit(0)));
try {
  const pgPort = await container('db', 'pgvector/pgvector:0.8.6-pg16', [
    '--publish',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql/data:rw',
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env',
    'POSTGRES_USER=sekereagle_test',
    '--env',
    'POSTGRES_DB=sekereagle_test',
  ]);
  const accessKey = randomBytes(12).toString('hex'),
    secretKey = randomBytes(24).toString('hex');
  const minioName = `${name}-storage`;
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    minioName,
    '--publish',
    '127.0.0.1::9000',
    '--tmpfs',
    '/data:rw,size=2g',
    '--env',
    `MINIO_ROOT_USER=${accessKey}`,
    '--env',
    `MINIO_ROOT_PASSWORD=${secretKey}`,
    'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    'server',
    '/data',
  ]);
  containers.push(minioName);
  const minioPort = run('docker', ['port', minioName, '9000']).split(':').at(-1);
  // Reserve an ephemeral API port without touching any existing server.
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const apiPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  let accessToken = '';
  gateway = createServer(async (req, res) => {
    if (req.url === '/__test/login') {
      res.writeHead(302, {
        'set-cookie': `sekereagle_access=${accessToken}; HttpOnly; SameSite=Strict; Path=/api`,
        location: '/',
      });
      res.end();
      return;
    }
    if (req.url.startsWith('/api/') || req.url.startsWith('/sekereagle-test/')) {
      const port = req.url.startsWith('/api/') ? apiPort : Number(minioPort);
      const upstream = proxyRequest(
        { host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502);
        res.end('Test service unavailable');
      });
      req.pipe(upstream);
      return;
    }
    try {
      const path = resolve(root, 'apps/web/dist', `.${decodeURIComponent(req.url.split('?')[0])}`);
      if (
        !path.startsWith(resolve(root, 'apps/web/dist') + '/') &&
        path !== resolve(root, 'apps/web/dist')
      )
        throw new Error('Invalid path');
      const file = (await stat(path).catch(() => null))?.isFile()
        ? path
        : join(root, 'apps/web/dist/index.html');
      res.setHeader(
        'content-type',
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
        }[extname(file)] ?? 'application/octet-stream',
      );
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) =>
    gateway.listen(Number(process.env.PHOTO_WORKBENCH_PORT ?? 0), '127.0.0.1', resolve),
  );
  const origin = `http://localhost:${gateway.address().port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    CANONICAL_ORIGIN: origin,
    DATABASE_URL: `postgresql://sekereagle_test@127.0.0.1:${pgPort}/sekereagle_test`,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    ACCESS_TOKEN_TTL_SECONDS: '86400',
    REFRESH_TOKEN_TTL_SECONDS: '86400',
    S3_ENDPOINT: `http://127.0.0.1:${minioPort}`,
    S3_PUBLIC_ENDPOINT: origin,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'sekereagle-test',
    S3_ACCESS_KEY_ID: accessKey,
    S3_SECRET_ACCESS_KEY: secretKey,
    MLX_EMBEDDING_URL: 'http://127.0.0.1:9',
    OLLAMA_URL: 'http://127.0.0.1:9',
    PHOTO_FACE_PYTHON: resolve('.omx/photo-face/venv/bin/python'),
    PHOTO_FACE_MODEL_DIR: resolve('.omx/photo-face/models'),
  };
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: env.S3_BUCKET,
  });
  run(process.execPath, ['scripts/assert-safe-target.mjs'], env);
  await waitFor(
    async () =>
      spawnSync('docker', [
        'exec',
        containers[0],
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'sekereagle_test',
        '-d',
        'sekereagle_test',
      ]).status === 0,
    'PostgreSQL',
  );
  await waitFor(
    async () =>
      fetch(`${env.S3_ENDPOINT}/minio/health/live`)
        .then((x) => x.ok)
        .catch(() => false),
    'test object storage',
  );
  run(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      'apps/api/prisma/schema.prisma',
    ],
    env,
  );
  db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const owner = await db.user.create({
    data: {
      email: 'photo-test@example.invalid',
      passwordHash: 'unusable-test-only',
      role: 'ADMIN',
    },
  });
  accessToken = await new JwtService({ secret: env.JWT_ACCESS_SECRET }).signAsync(
    {
      sub: owner.id,
      email: owner.email,
      role: owner.role,
      authVersion: owner.authVersion,
      kind: 'browser',
    },
    { expiresIn: '24h' },
  );
  for (const libraryMode of ['MATERIAL', 'PHOTO'])
    await db.eagleProcessingSetting.create({
      data: { ownerId: owner.id, libraryMode, mode: 'MANUAL' },
    });
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));

  child('apps/api/dist/main.js', env, 'api');
  await waitFor(
    async () =>
      fetch(`${origin}/api/photos/assets`, {
        headers: { cookie: `sekereagle_access=${accessToken}` },
      })
        .then((x) => x.ok)
        .catch(() => false),
    'API',
  );
  const api = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        cookie: `sekereagle_access=${accessToken}`,
        origin,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(`Test API ${path}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  };
  const photoDirectory = join(root, '.omx/test-photos');
  await mkdir(photoDirectory, { recursive: true });
  const samplePath = join(photoDirectory, 'astronaut.png');
  let source = await readFile(samplePath).catch(() => null);
  if (!source) {
    const response = await fetch(
      'https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/astronaut.png',
    );
    if (!response.ok) throw new Error('Public test photo download failed');
    source = Buffer.from(await response.arrayBuffer());
    await writeFile(samplePath, source);
  }
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',
  );
  const sharpPhoto = await sharp(source)
    .withExif({
      IFD0: { Make: 'Synthetic Test', Model: 'Test Camera' },
      IFD2: {
        DateTimeOriginal: '2024:03:01 12:30:00',
        OffsetTimeOriginal: '+08:00',
        LensModel: 'Test Lens',
        FNumber: '28/10',
        ISOSpeedRatings: '200',
      },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '31/1 13/1 48/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '121/1 28/1 12/1',
      },
    })
    .jpeg({ quality: 95 })
    .toBuffer();
  const blurryPhoto = await sharp(source)
    .blur(3)
    .withExif({
      IFD0: { Make: 'Synthetic Test', Model: 'Test Camera' },
      IFD2: {
        DateTimeOriginal: '2024:03:01 12:30:01',
        OffsetTimeOriginal: '+08:00',
        LensModel: 'Test Lens',
      },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  async function upload(mode, bytes, fileName, mimeType = 'image/jpeg') {
    const session = await api(`/${mode}/uploads`, {
      originalName: fileName,
      mimeType,
      size: bytes.length,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const { uploadUrl } = await api(`/${mode}/uploads/${session.id}/parts/1`, {});
    const response = await fetch(uploadUrl, { method: 'PUT', body: bytes });
    assert.equal(response.status, 200);
    return api(`/${mode}/uploads/${session.id}/complete`, {
      parts: [{ partNumber: 1, etag: response.headers.get('etag') }],
    });
  }
  const a = await upload('photos', sharpPhoto, 'public-sample-synthetic-exif.jpg'),
    b = await upload('photos', blurryPhoto, 'public-sample-blurred.jpg'),
    material = await upload('eagle', sharpPhoto, 'material-independent.jpg');
  assert.notEqual(a.assetId, material.assetId);
  assert.notEqual(a.assetId, b.assetId);
  for (const [mode, assetId] of [
    ['photos', a.assetId],
    ['eagle', material.assetId],
  ]) {
    const response = await fetch(`${origin}/api/${mode}/assets/${assetId}/original`, {
      headers: { cookie: `sekereagle_access=${accessToken}` },
    });
    assert.equal(response.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex'),
      createHash('sha256').update(sharpPhoto).digest('hex'),
    );
  }
  // Mixed aspect ratios exercise the shared masonry through real uploads and previews.
  // Crops deliberately have no EXIF: they must not join the timestamped similar-photo stack.
  const aspectSamples = [
    { name: 'landscape', width: 512, height: 288, left: 0, top: 112 },
    { name: 'portrait', width: 288, height: 512, left: 112, top: 0 },
  ];
  const aspectAssetIds = new Map();
  for (const sample of aspectSamples) {
    const bytes = await sharp(source)
      .extract({ left: sample.left, top: sample.top, width: sample.width, height: sample.height })
      .jpeg({ quality: 95 })
      .toBuffer();
    for (const mode of ['photos', 'eagle']) {
      const uploaded = await upload(mode, bytes, `public-sample-${sample.name}.jpg`);
      aspectAssetIds.set(`${mode}:${sample.name}`, uploaded.assetId);
    }
  }
  child('apps/worker/dist/main.js', env, 'worker');
  await waitFor(
    async () =>
      (await db.eagleAsset.count({ where: { ownerId: owner.id, lifecycleStatus: 'READY' } })) === 7,
    'generated previews',
    240,
  );
  const photos = await api('/photos/assets?limit=20');
  assert.equal(photos.items.length, 4);
  const materials = await api('/eagle/assets?limit=20');
  assert.equal(materials.items.length, 3);
  for (const sample of aspectSamples) {
    for (const [mode, items] of [
      ['photos', photos.items],
      ['eagle', materials.items],
    ]) {
      const item = items.find((item) => item.id === aspectAssetIds.get(`${mode}:${sample.name}`));
      assert.ok(item, `${sample.name} sample exists in each isolated mode`);
      assert.equal(item.width, sample.width);
      assert.equal(item.height, sample.height);
    }
  }
  const capturedPhoto = photos.items.find((item) => item.id === b.assetId);
  assert.equal(capturedPhoto.photoMetadata.cameraModel, 'Test Camera');
  assert.equal(capturedPhoto.photoMetadata.capturedAt, '2024-03-01T04:30:01.000Z');
  assert.equal((await api('/photos/assets?limit=20&gps=WITH')).items.length, 1);
  const faceScan = await api('/photos/photography/people/scan', {});
  assert.ok(faceScan.queued >= 4);
  await waitFor(
    async () =>
      (await db.eagleAssetProcessingJob.count({
        where: { ownerId: owner.id, kind: 'ANALYZE_PHOTO_FACES', status: 'COMPLETED' },
      })) === 4,
    'local face inference',
    240,
  );
  const people = await api('/photos/photography/people');
  assert.ok(people.people.length >= 1);
  const automaticGroups = await api('/photos/photography/groups');
  assert.equal(automaticGroups.length, 1, 'worker automatically stacks matching photographs');
  const groupScan = await api('/photos/photography/groups/scan', {});
  assert.equal(groupScan.created, 0, 'batch scan preserves the existing automatic stack');
  const groups = await api('/photos/photography/groups');
  assert.equal(groups[0].bestAssetId, a.assetId);
  const cameraCases = [];
  if (process.env.PHOTO_WORKBENCH_CAMERA === '1') {
    const fixtures = await createCameraFixtures(join(root, '.omx/test-camera/workbench'));
    for (const fixture of fixtures) {
      const bytes = await readFile(fixture.path);
      for (const mode of ['photos', 'eagle']) {
        const uploaded = await upload(mode, bytes, fixture.name, fixture.mimeType);
        cameraCases.push({
          ...fixture,
          mode,
          assetId: uploaded.assetId,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
    await waitFor(
      async () =>
        (await db.eagleAsset.count({ where: { ownerId: owner.id, lifecycleStatus: 'READY' } })) ===
        7 + cameraCases.length,
      'camera RAW and video previews',
      480,
    );
    for (const sample of cameraCases) {
      const detail = await api(`/${sample.mode}/assets/${sample.assetId}`);
      assert.ok(detail.width > 0 && detail.height > 0);
      const original = await fetch(
        `${origin}/api/${sample.mode}/assets/${sample.assetId}/original`,
        { headers: { cookie: `sekereagle_access=${accessToken}` } },
      );
      assert.equal(original.status, 200);
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await original.arrayBuffer()))
          .digest('hex'),
        sample.sha256,
      );
      const playback = detail.renditions.find(
        (item) => item.kind === 'PREVIEW' && item.mimeType === 'video/mp4',
      );
      if (sample.codec) {
        assert.ok(playback, 'camera video has an authorized browser playback copy');
        const ranged = await fetch(
          `${origin}/api/${sample.mode}/assets/${sample.assetId}/renditions/${playback.id}`,
          { headers: { cookie: `sekereagle_access=${accessToken}`, range: 'bytes=0-31' } },
        );
        assert.equal(ranged.status, 206);
        assert.match(ranged.headers.get('content-range'), /^bytes 0-31\//);
        assert.equal((await ranged.arrayBuffer()).byteLength, 32);
        const otherMode = sample.mode === 'photos' ? 'eagle' : 'photos';
        const denied = await fetch(
          `${origin}/api/${otherMode}/assets/${sample.assetId}/renditions/${playback.id}`,
          { headers: { cookie: `sekereagle_access=${accessToken}`, range: 'invalid' } },
        );
        assert.equal(denied.status, 404, 'scope denial precedes range validation');
      }
    }
  }
  // Synthetic historical import dates make the full-library date rail visible in acceptance.
  // Files without EXIF retain the production fallback: chronologicalAt equals libraryAddedAt.
  const historicalImports = [
    [aspectAssetIds.get('photos:portrait'), '2025-06-01T12:00:00Z'],
    [aspectAssetIds.get('photos:landscape'), '2023-09-01T12:00:00Z'],
    ...cameraCases
      .filter((row) => row.mode === 'photos')
      .map((row, index) => [row.assetId, `${2022 - index}-02-01T12:00:00Z`]),
  ];
  for (const [id, timestamp] of historicalImports) {
    if (!id) continue;
    await db.eagleAsset.update({
      where: { id },
      data: { chronologicalAt: new Date(timestamp), libraryAddedAt: new Date(timestamp) },
    });
  }
  const restoreBucket = 'sekereagle-test-assets';
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: restoreBucket,
  });
  await s3.send(new CreateBucketCommand({ Bucket: restoreBucket }));
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET }));
  assert.equal(objects.IsTruncated, false);
  for (const entry of objects.Contents ?? []) {
    const object = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: entry.Key }));
    const bytes = await object.Body.transformToByteArray();
    await s3.send(
      new PutObjectCommand({
        Bucket: restoreBucket,
        Key: entry.Key,
        Body: bytes,
        ContentType: object.ContentType,
      }),
    );
    const restored = await s3.send(new GetObjectCommand({ Bucket: restoreBucket, Key: entry.Key }));
    assert.equal(
      createHash('sha256')
        .update(await restored.Body.transformToByteArray())
        .digest('hex'),
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
  s3.destroy();
  const metadata = await db.eaglePhotoMetadata.findMany({
    where: { ownerId: owner.id },
    select: {
      assetId: true,
      sharpnessScore: true,
      cameraModel: true,
      latitude: true,
      longitude: true,
    },
  });
  const result = {
    pid: process.pid,
    origin,
    loginUrl: `${origin}/__test/login`,
    containers,
    ownerId: owner.id,
    photos: (await api('/photos/assets?limit=100')).items.length,
    materials: (await api('/eagle/assets?limit=100')).items.length,
    cameraCases: cameraCases.map(({ name, mimeType, mode, assetId }) => ({
      name,
      mimeType,
      mode,
      assetId,
    })),
    people: people.people.length,
    faces: people.people.reduce((n, p) => n + p.faces.length, 0),
    groups: groups.length,
    metadata,
    source: {
      url: 'https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut',
      license: 'NASA public domain',
      synthetic:
        'EXIF date, GPS, camera/lens, historical import dates and blurred / landscape / portrait derivatives are synthetic test conditions',
    },
    restoredObjects: objects.Contents?.length ?? 0,
    status: 'passed',
  };
  await writeFile(join(artifacts, 'photo-workbench.json'), JSON.stringify(result, null, 2));
  console.log(`Photo smoke passed. Isolated acceptance site: ${result.loginUrl}`);
  if (process.argv.includes('--serve')) await new Promise(() => {});
  else await cleanup();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Photo test failed');
  await cleanup();
  process.exitCode = 1;
}
