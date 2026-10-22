import { DEFAULT_PHOTO_EDITS } from '../../packages/library-core/dist/index.js';
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
import bcrypt from 'bcrypt';
import { createLivePhotoFixtures } from './live-photo-fixtures.mjs';
import { createCameraFixtures } from './camera-media-fixtures.mjs';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const root = process.cwd(),
  name = `sekereagle-photo-workbench-${randomUUID().slice(0, 8)}`;
const containers = [],
  children = [],
  timers = [];
let db, gateway;
// Separate MinIO container; mirror the gateway path accepted by the real Web uploader.
const storageBucket = 'sekereagle-assets';
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
  let browserCookies = [];
  gateway = createServer(async (req, res) => {
    if (req.url === '/__test/login') {
      res.writeHead(302, {
        'set-cookie': browserCookies,
        location: '/',
      });
      res.end();
      return;
    }
    if (req.url.startsWith('/api/') || req.url.startsWith(`/${storageBucket}/`)) {
      const port = req.url.startsWith('/api/') ? apiPort : Number(minioPort);
      const upstream = proxyRequest(
        {
          host: '127.0.0.1',
          port,
          path: req.url,
          method: req.method,
          // Mirror nginx: MinIO must see the canonical host used to sign the part URL,
          // including when the browser reaches this gateway via a loopback alias.
          headers: req.url.startsWith('/api/')
            ? req.headers
            : { ...req.headers, host: new URL(origin).host },
        },
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
          '.wasm': 'application/wasm',
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
    S3_BUCKET: storageBucket,
    S3_ACCESS_KEY_ID: accessKey,
    S3_SECRET_ACCESS_KEY: secretKey,
    MLX_EMBEDDING_URL: 'http://127.0.0.1:9',
    OLLAMA_URL: 'http://127.0.0.1:9',
    PHOTO_FACE_PYTHON: process.env.PHOTO_FACE_PYTHON || resolve('.omx/photo-face/venv/bin/python'),
    PHOTO_FACE_MODEL_DIR: process.env.PHOTO_FACE_MODEL_DIR || resolve('.omx/photo-face/models'),
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
  const testPassword = randomBytes(24).toString('hex');
  const owner = await db.user.create({
    data: {
      email: 'photo-test@example.invalid',
      passwordHash: await bcrypt.hash(testPassword, 12),
      role: 'ADMIN',
    },
  });
  const legacyAccessToken = await new JwtService({ secret: env.JWT_ACCESS_SECRET }).signAsync(
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
      fetch(`${origin}/api/health/ready`)
        .then((x) => x.ok)
        .catch(() => false),
    'API readiness',
  );
  const rejected = await fetch(`${origin}/api/photos/assets`, {
    headers: { cookie: `sekereagle_access=${legacyAccessToken}` },
  });
  assert.equal(rejected.status, 401, 'signed tokens without a session family are rejected');
  const deniedLogin = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin: 'http://untrusted.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ email: owner.email, password: testPassword }),
  });
  assert.equal(deniedLogin.status, 403, 'login rejects an untrusted browser origin');
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: owner.email, password: testPassword }),
  });
  assert.equal(login.status, 201, 'real HTTP login creates a session');
  browserCookies = login.headers.getSetCookie();
  assert.equal(browserCookies.length, 2);
  accessToken = browserCookies
    .find((cookie) => cookie.startsWith('sekereagle_access='))
    ?.split(';')[0]
    .slice('sekereagle_access='.length);
  assert.ok(accessToken, 'login writes an access cookie');
  assert.ok(browserCookies.some((cookie) => cookie.startsWith('sekereagle_refresh=')));
  const api = async (path, body, method = body ? 'POST' : 'GET', attempt = 0) => {
    await sleep(200);
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        cookie: `sekereagle_access=${accessToken}`,
        origin,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 429 && attempt < 3) {
      await response.arrayBuffer();
      const seconds = Number(response.headers.get('retry-after') ?? '2');
      await sleep(Math.max(1, Math.min(60, seconds || 2)) * 1000);
      return api(path, body, method, attempt + 1);
    }
    if (!response.ok)
      throw new Error(`Test API ${path}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  };
  const photoDirectory = join(root, '.omx/test-photos');
  await mkdir(photoDirectory, { recursive: true });
  const samplePath = join(photoDirectory, 'astronaut.png');
  const basic = process.env.PHOTO_WORKBENCH_BASIC === '1';
  let source;
  if (basic) {
    // Deterministic local fixture keeps the HTTP/metadata CI independent of downloads and face models.
    const pixels = Buffer.alloc(512 * 512 * 3);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 3;
        pixels[i] = x % 256;
        pixels[i + 1] = y % 256;
        pixels[i + 2] = (x ^ y) % 256;
      }
    source = await sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } })
      .png()
      .toBuffer();
  } else {
    source = await readFile(samplePath).catch(() => null);
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
  }
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
  async function upload(mode, bytes, fileName, mimeType = 'image/jpeg', options = {}) {
    const session = await api(`/${mode}/uploads`, {
      originalName: fileName,
      mimeType,
      size: bytes.length,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
      ...options,
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
  if (basic) {
    if (process.env.PHOTO_WORKBENCH_EDITED_COPY === '1') {
      const editedBytes = await sharp(sharpPhoto)
        .extract({ left: 128, top: 0, width: 256, height: 512 })
        .rotate(90)
        .png()
        .toBuffer();
      for (const [mode, sourceId] of [
        ['eagle', material.assetId],
        ['photos', a.assetId],
      ]) {
        const detail = await api(`/${mode}/assets/${sourceId}`);
        const editRecipe = { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, exposure: 0.25 } };
        await api(
          `/${mode}/assets/${sourceId}/edit-recipe`,
          { mediaRevision: detail.mediaRevision, recipe: editRecipe },
          'PUT',
        );
        assert.equal(
          (await api(`/${mode}/assets/${sourceId}/edit-recipe`)).entry.recipe.edits.exposure,
          0.25,
        );
        const copied = await upload(mode, editedBytes, 'editor-output.png', 'image/png', {
          editRecipe,
          duplicatePolicy: 'CREATE_COPY',
          copySourceAssetId: sourceId,
          copySourceRowVersion: detail.rowVersion,
        });
        assert.notEqual(copied.assetId, sourceId);
        const frozen = (await api(`/${mode}/assets/${copied.assetId}/edit-recipe`)).entry;
        assert.equal(frozen.baseAssetId, sourceId);
        assert.equal(frozen.recipe.edits.exposure, 0.25);
        await waitFor(
          async () =>
            (await db.eagleAsset.findUniqueOrThrow({ where: { id: copied.assetId } }))
              .lifecycleStatus === 'READY',
          'edited copy processing',
          240,
        );
        const copy = await api(`/${mode}/assets/${copied.assetId}`);
        assert.ok(
          copy.manualTags.some((tag) => tag.name === '已编辑'),
          'saved edits must be filterable by their edited tag',
        );
        assert.equal(copy.width, 512);
        assert.equal(copy.height, 256);
        if (mode === 'photos') {
          assert.equal(
            copy.chronologicalAt,
            detail.chronologicalAt,
            'pixel processing must retain source timeline position',
          );
          assert.equal(copy.photoMetadata.captureMetadataInherited, true);
          assert.equal(copy.photoMetadata.cameraModel, detail.photoMetadata.cameraModel);
          assert.equal(copy.photoMetadata.capturedAt, detail.photoMetadata.capturedAt);
          const photoPage = await api('/photos/assets?limit=100');
          const stack = photoPage.photoStacks.find((row) => row.assetIds.includes(sourceId));
          assert.ok(
            stack?.assetIds.includes(copy.id),
            'published edited copy belongs to source stack',
          );
          assert.equal(stack.cover.id, copy.id, 'processed edited copy becomes the default cover');
        }
        const original = await fetch(`${origin}/api/${mode}/assets/${sourceId}/original`, {
          headers: { cookie: `sekereagle_access=${accessToken}` },
        });
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), sharpPhoto);
        const other = mode === 'photos' ? 'eagle' : 'photos';
        const denied = await fetch(`${origin}/api/${other}/uploads`, {
          method: 'POST',
          headers: {
            cookie: `sekereagle_access=${accessToken}`,
            origin,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            originalName: 'edited.png',
            mimeType: 'image/png',
            size: editedBytes.length,
            duplicatePolicy: 'CREATE_COPY',
            copySourceAssetId: sourceId,
            copySourceRowVersion: detail.rowVersion,
          }),
        });
        assert.equal(denied.status, 404);
      }
      console.log(
        'Existing editor copy HTTP upload, original preservation, previews and mode boundaries passed.',
      );
    }
  }
  let people, groups;
  if (!basic) {
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
    people = await api('/photos/photography/people');
    assert.ok(people.people.length >= 1);
    const automaticGroups = await api('/photos/photography/groups');
    assert.equal(automaticGroups.length, 1, 'worker automatically stacks matching photographs');
    const groupScan = await api('/photos/photography/groups/scan', {});
    assert.equal(groupScan.created, 0, 'batch scan preserves the existing automatic stack');
    groups = await api('/photos/photography/groups');
    assert.equal(groups[0].bestAssetId, a.assetId);
  }
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
        (await db.eagleAsset.count({
          where: {
            ownerId: owner.id,
            id: { in: cameraCases.map((row) => row.assetId) },
            lifecycleStatus: 'READY',
          },
        })) === cameraCases.length,
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
      if (sample.mimeType === 'image/x-adobe-dng') {
        const edit = detail.renditions.find(
          (row) => row.variant === 'edit' && row.revision === detail.mediaRevision,
        );
        assert.ok(
          edit && edit.mimeType === 'image/webp',
          'RAW has a dedicated browser-editable derivative',
        );
        assert.ok(edit.width > 0 && edit.height > 0 && Math.max(edit.width, edit.height) <= 6000);
        const editResponse = await fetch(
          `${origin}/api/${sample.mode}/assets/${sample.assetId}/renditions/${edit.id}`,
          {
            headers: { cookie: `sekereagle_access=${accessToken}` },
          },
        );
        assert.equal(editResponse.status, 200);
        const decodedEdit = Buffer.from(await editResponse.arrayBuffer());
        const editMetadata = await sharp(decodedEdit).metadata();
        assert.equal(editMetadata.width, edit.width);
        assert.equal(editMetadata.height, edit.height);
        const editedPng = await sharp(decodedEdit).png().toBuffer();
        const editedCopy = await upload(sample.mode, editedPng, 'raw-edited.png', 'image/png', {
          duplicatePolicy: 'CREATE_COPY',
          copySourceAssetId: sample.assetId,
          copySourceRowVersion: detail.rowVersion,
        });
        assert.notEqual(editedCopy.assetId, sample.assetId);
        await waitFor(
          async () =>
            (await api(`/${sample.mode}/assets/${editedCopy.assetId}`)).lifecycleStatus === 'READY',
          'RAW edited PNG copy',
          120,
        );
        assert.equal(
          (await api(`/${sample.mode}/assets/${sample.assetId}`)).mimeType,
          sample.mimeType,
        );
        const otherMode = sample.mode === 'photos' ? 'eagle' : 'photos';
        const denied = await fetch(
          `${origin}/api/${otherMode}/assets/${sample.assetId}/renditions/${edit.id}`,
          {
            headers: { cookie: `sekereagle_access=${accessToken}` },
          },
        );
        assert.equal(denied.status, 404, 'RAW edit derivative remains mode scoped');
        const { readMediaProcessingFacts } =
          await import('../../apps/api/dist/eagle/media-processing-facts.js');
        const stored = await db.eagleAsset.findUniqueOrThrow({ where: { id: sample.assetId } });
        const mode = sample.mode === 'photos' ? 'PHOTO' : 'MATERIAL';
        const preview = detail.renditions.find(
          (row) => row.kind === 'PREVIEW' && row.variant === 'default',
        );
        for (const [variant, id] of [
          ['edit', edit.id],
          ['default', preview.id],
        ]) {
          await db.eagleAssetRendition.delete({ where: { id } });
          const [facts] = await readMediaProcessingFacts(db, stored.ownerId, mode, [
            sample.assetId,
          ]);
          assert.equal(
            facts.renditionsReady,
            false,
            `RAW missing ${variant} copy must be repairable`,
          );
          await api(
            `/admin/${sample.mode === 'photos' ? 'photo' : 'eagle'}-processing/reconcile`,
            {},
          );
          await waitFor(
            async () => {
              const row = await api(`/${sample.mode}/assets/${sample.assetId}`);
              return row.renditions.some(
                (r) => r.variant === variant && r.revision === row.mediaRevision,
              );
            },
            `RAW ${variant} derivative repair`,
            120,
          );
        }
        const preservedOriginal = await fetch(
          `${origin}/api/${sample.mode}/assets/${sample.assetId}/original`,
          {
            headers: { cookie: `sekereagle_access=${accessToken}` },
          },
        );
        assert.equal(preservedOriginal.status, 200);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await preservedOriginal.arrayBuffer()))
            .digest('hex'),
          sample.sha256,
        );
      }
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
  const liveCases = [];
  if (process.env.PHOTO_WORKBENCH_LIVE === '1') {
    const fixtures = await createLivePhotoFixtures(
      join(root, '.omx/test-live-photos/workbench'),
      source,
    );
    // Movie-first imports verify pairing does not depend on upload order.
    const ordered = [fixtures[1], fixtures[0], fixtures[2], fixtures[3]];
    for (const mode of ['photos', 'eagle']) {
      const samples = [];
      for (const fixture of ordered) {
        const row = await upload(mode, fixture.bytes, fixture.name, fixture.mimeType);
        samples.push({ ...fixture, assetId: row.assetId });
      }
      await waitFor(
        async () =>
          (await db.eagleAsset.count({
            where: { id: { in: samples.map((row) => row.assetId) }, lifecycleStatus: 'READY' },
          })) === samples.length,
        'live photo previews',
        480,
      );
      const [movie, still, embedded, ordinary] = samples;
      const paired = await api(`/${mode}/assets/${still.assetId}`);
      assert.equal(paired.livePhotoMotion.assetId, movie.assetId);
      const ordinaryDetail = await api(`/${mode}/assets/${ordinary.assetId}`);
      assert.equal(ordinaryDetail.livePhotoMotion, undefined);
      const embeddedDetail = await api(`/${mode}/assets/${embedded.assetId}`);
      assert.ok(
        embeddedDetail.renditions.some(
          (row) => row.kind === 'PREVIEW' && row.mimeType === 'video/mp4',
        ),
      );
      assert.ok(
        embeddedDetail.renditions.some(
          (row) => row.kind === 'PREVIEW' && row.mimeType.startsWith('image/'),
        ),
      );
      const otherMode = mode === 'photos' ? 'eagle' : 'photos';
      for (const [assetId, renditionId] of [
        [movie.assetId, paired.livePhotoMotion.renditionId],
        [
          embedded.assetId,
          embeddedDetail.renditions.find((row) => row.mimeType === 'video/mp4').id,
        ],
      ]) {
        const response = await fetch(
          `${origin}/api/${mode}/assets/${assetId}/renditions/${renditionId}`,
          { headers: { cookie: `sekereagle_access=${accessToken}`, range: 'bytes=0-31' } },
        );
        assert.equal(response.status, 206);
        assert.equal((await response.arrayBuffer()).byteLength, 32);
        assert.equal(
          (
            await fetch(`${origin}/api/${otherMode}/assets/${assetId}/renditions/${renditionId}`, {
              headers: { cookie: `sekereagle_access=${accessToken}` },
            })
          ).status,
          404,
        );
      }
      await db.eagleAsset.update({ where: { id: movie.assetId }, data: { isPrivate: true } });
      assert.equal((await api(`/${mode}/assets/${still.assetId}`)).livePhotoMotion, undefined);
      assert.equal(
        (
          await fetch(
            `${origin}/api/${mode}/assets/${movie.assetId}/renditions/${paired.livePhotoMotion.renditionId}`,
            { headers: { cookie: `sekereagle_access=${accessToken}` } },
          )
        ).status,
        404,
      );
      await db.eagleAsset.update({ where: { id: movie.assetId }, data: { isPrivate: false } });
      const trashed = await api(`/${mode}/assets/batch/trash`, { assetIds: [still.assetId] });
      assert.equal(trashed.affectedAssetCount, 2);
      const restored = await api(`/${mode}/assets/batch/restore`, { assetIds: [still.assetId] });
      assert.equal(restored.affectedAssetCount, 2);
      for (const sample of samples) {
        const original = await fetch(`${origin}/api/${mode}/assets/${sample.assetId}/original`, {
          headers: { cookie: `sekereagle_access=${accessToken}` },
        });
        assert.equal(original.status, 200);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await original.arrayBuffer()))
            .digest('hex'),
          createHash('sha256').update(sample.bytes).digest('hex'),
        );
        liveCases.push({ mode, name: sample.name, assetId: sample.assetId });
      }
    }
  }
  const sendCases = [];
  if (process.env.PHOTO_WORKBENCH_SEND === '1') {
    const sample = liveCases.find((row) => row.mode === 'eagle' && row.name === 'apple-live.jpg');
    if (!sample) throw new Error('Sending smoke requires PHOTO_WORKBENCH_LIVE=1');
    const input = { operationId: randomUUID(), assetIds: [sample.assetId] };
    const original = await api(`/eagle/assets/${sample.assetId}`);
    const existingPhoto = liveCases.find(
      (row) => row.mode === 'photos' && row.name === 'apple-live.jpg',
    );
    await api('/photos/assets/batch/trash', { assetIds: [existingPhoto.assetId] });
    const result = await api('/eagle/assets/batch/send', input);
    assert.equal(result.targetMode, 'PHOTO');
    assert.equal(result.componentCount, 2);
    assert.deepEqual(await api('/eagle/assets/batch/send', input), result);
    assert.equal(
      (
        await fetch(`${origin}/api/eagle/assets/${sample.assetId}`, {
          headers: { cookie: `sekereagle_access=${accessToken}` },
        })
      ).status,
      404,
    );
    for (const row of result.assets) {
      const before = await fetch(`${origin}/api/eagle/assets/${row.sourceId}/original`, {
        headers: { cookie: `sekereagle_access=${accessToken}` },
      });
      const after = await fetch(`${origin}/api/photos/assets/${row.assetId}/original`, {
        headers: { cookie: `sekereagle_access=${accessToken}` },
      });
      assert.equal(after.status, 200);
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await before.arrayBuffer()))
          .digest('hex'),
        createHash('sha256')
          .update(Buffer.from(await after.arrayBuffer()))
          .digest('hex'),
      );
    }
    await waitFor(
      async () =>
        (await db.eagleAsset.count({
          where: { id: { in: result.assets.map((row) => row.assetId) }, lifecycleStatus: 'READY' },
        })) === result.assets.length,
      'sent live photo previews',
      480,
    );
    const targetId = result.assets.find((row) => row.sourceId === sample.assetId).assetId;
    const target = await api(`/photos/assets/${targetId}`);
    assert.equal(
      target.livePhotoMotion.assetId,
      result.assets.find((row) => row.sourceId !== sample.assetId).assetId,
    );
    assert.equal(target.displayName, original.displayName);
    sendCases.push(result);
    const reverse = await api('/photos/assets/batch/send', {
      operationId: randomUUID(),
      assetIds: [targetId],
    });
    assert.equal(reverse.targetMode, 'MATERIAL');
    assert.equal(reverse.componentCount, 2);
    await waitFor(
      async () =>
        (await db.eagleAsset.count({
          where: { id: { in: reverse.assets.map((row) => row.assetId) }, lifecycleStatus: 'READY' },
        })) === reverse.assets.length,
      'reverse sent live photo previews',
      480,
    );
    const materialTargetId = reverse.assets.find((row) => row.sourceId === targetId).assetId;
    const materialTarget = await api(`/eagle/assets/${materialTargetId}`);
    assert.equal(
      materialTarget.livePhotoMotion.assetId,
      reverse.assets.find((row) => row.sourceId !== targetId).assetId,
    );
    sendCases.push(reverse);
  }
  if (basic) {
    console.log(
      'Photo HTTP smoke passed: sessions, uploads, editor copies, camera formats, live photos and cross-library sends requested by flags.',
    );
    if (process.argv.includes('--serve')) {
      const result = {
        pid: process.pid,
        origin,
        loginUrl: `${origin}/__test/login`,
        containers,
        ownerId: owner.id,
        basic: true,
      };
      await writeFile(join(artifacts, 'photo-workbench.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ origin, loginUrl: result.loginUrl, basic: true }));
      await new Promise(() => {});
    }
    await cleanup();
    process.exit(0);
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
    liveCases,
    sendCases,
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
