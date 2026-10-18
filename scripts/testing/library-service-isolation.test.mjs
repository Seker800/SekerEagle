import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { EagleMediaService } from '../../apps/api/dist/eagle/eagle-media.service.js';
import { EagleUploadService } from '../../apps/api/dist/eagle/eagle-upload.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());

async function fixtures() {
  const ownerId = randomUUID();
  await prisma.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'test-only' },
  });
  const create = (libraryMode) =>
    prisma.eagleAsset.create({
      data: {
        ownerId,
        libraryMode,
        originalName: 'test.jpg',
        displayName: 'sample',
        normalizedDisplayName: 'sample',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        sha256: 'a'.repeat(64),
        originalObjectKey: `users/${ownerId}/assets/${randomUUID()}/original.jpg`,
        lifecycleStatus: 'READY',
      },
    });
  return {
    ownerId,
    material: await create('MATERIAL'),
    photo: await create('PHOTO'),
    materials: new EagleService(prisma),
    photos: new EagleService(prisma, undefined, 'PHOTO'),
  };
}

test('real service lists and ID reads cannot cross libraries or owners', async () => {
  const f = await fixtures();
  assert.deepEqual(
    (await f.materials.listAssets(f.ownerId, { limit: 50 })).items.map((x) => x.id),
    [f.material.id],
  );
  const rows = await f.photos.listAssets(f.ownerId, { limit: 50 });
  assert.deepEqual(
    rows.items.map((x) => x.id),
    [f.photo.id],
  );
  assert.match(rows.items[0].originalUrl, /^\/api\/photos\//);
  await assert.rejects(() => f.materials.getAsset(f.ownerId, f.photo.id), NotFoundException);
  await assert.rejects(() => f.photos.getAsset(f.ownerId, f.material.id), NotFoundException);
  await assert.rejects(() => f.photos.getAsset(randomUUID(), f.photo.id), NotFoundException);
});

test('same-name tags stay independent and mixed-library batch changes roll back', async () => {
  const f = await fixtures();
  const materialTag = await f.materials.createManualTag(f.ownerId, { name: 'test-tag' });
  const photoTag = await f.photos.createManualTag(f.ownerId, { name: 'test-tag' });
  assert.notEqual(materialTag.id, photoTag.id);
  await f.photos.replaceAssetTags(f.ownerId, f.photo.id, [photoTag.id]);
  await assert.rejects(
    () => f.photos.replaceAssetTags(f.ownerId, f.photo.id, [materialTag.id]),
    NotFoundException,
  );
  await assert.rejects(
    () =>
      f.photos.batchUpdate(f.ownerId, {
        assets: [
          { assetId: f.photo.id, rowVersion: 1 },
          { assetId: f.material.id, rowVersion: 1 },
        ],
        rating: 5,
      }),
    NotFoundException,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.photo.id } })).rating,
    null,
  );
});

test('media denies wrong mode before accessing the object store', async () => {
  const f = await fixtures();
  let reads = 0;
  const storage = {
    getObject: () => {
      reads++;
      throw new Error('unexpected storage read');
    },
  };
  await assert.rejects(
    () => new EagleMediaService(prisma, storage).getOriginal(f.ownerId, f.photo.id),
    NotFoundException,
  );
  await assert.rejects(
    () => new EagleMediaService(prisma, storage, 'PHOTO').getOriginal(f.ownerId, f.material.id),
    NotFoundException,
  );
  assert.equal(reads, 0);
});

test('photo upload freezes mode, rejects old-route resume and deduplicates only within photos', async () => {
  const f = await fixtures();
  await prisma.eagleAsset.delete({ where: { id: f.photo.id } });
  const storage = {
    createMultipartUpload: async () => randomUUID(),
    completeMultipartUpload: async () => {},
    headObject: async () => ({ ContentLength: 1 }),
    abortMultipartUpload: async () => {},
    deleteObject: async () => {},
  };
  const capabilities = { assertUploadAllowed: () => ({ mimeType: 'image/jpeg' }) };
  const inspection = {
    inspect: async () => ({
      sha256: 'a'.repeat(64),
      format: 'jpeg',
      width: 1,
      height: 1,
      durationMs: null,
    }),
  };
  const photos = new EagleUploadService(prisma, storage, capabilities, inspection, 'PHOTO');
  const materials = new EagleUploadService(prisma, storage, capabilities, inspection);
  const upload = await photos.initiate(f.ownerId, {
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1,
  });
  await assert.rejects(() => materials.getSession(f.ownerId, upload.id), NotFoundException);
  const completed = await photos.complete(f.ownerId, upload.id, {
    parts: [{ partNumber: 1, etag: 'part' }],
  });
  assert.notEqual(completed.assetId, f.material.id);
  assert.equal(completed.duplicate, false);
  const row = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: completed.assetId } });
  assert.equal(row.libraryMode, 'PHOTO');
  const jobs = await prisma.eagleAssetProcessingJob.findMany({ where: { assetId: row.id } });
  assert.ok(jobs.length > 0);
  assert.ok(jobs.every((job) => job.libraryMode === 'PHOTO'));
});

test('pagination cursor is bound to its original owner and library', async () => {
  const f = await fixtures();
  const { aspectRatio: _generated, ...photoData } = f.photo;
  void _generated;
  await prisma.eagleAsset.create({
    data: {
      ...photoData,
      id: randomUUID(),
      originalObjectKey: `users/${f.ownerId}/assets/${randomUUID()}/second.jpg`,
    },
  });
  const page = await f.photos.listAssets(f.ownerId, { limit: 1 });
  assert.ok(page.nextCursor);
  await assert.rejects(
    () => f.materials.listAssets(f.ownerId, { limit: 1, cursor: page.nextCursor }),
    /游标/,
  );
  await assert.rejects(
    () => f.photos.listAssets(randomUUID(), { limit: 1, cursor: page.nextCursor }),
    /游标/,
  );
  assert.equal(
    (await f.photos.listAssets(f.ownerId, { limit: 1, cursor: page.nextCursor })).items.length,
    1,
  );
});

test('real Nest photo routes preserve guards and inject the photo service graph', async () => {
  const defaults = {
    NODE_ENV: 'test',
    PORT: '3000',
    CANONICAL_ORIGIN: 'http://localhost:8180',
    JWT_ACCESS_SECRET: 'isolated-test-signing-key-at-least-32-characters',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_SECONDS: '2592000',
    S3_PUBLIC_ENDPOINT: 'http://localhost:8180',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'isolated-test-only',
    S3_SECRET_ACCESS_KEY: 'isolated-test-only',
  };
  for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
  const { NestFactory } = await import('@nestjs/core');
  const { ValidationPipe } = await import('@nestjs/common');
  const { default: cookieParser } = await import('cookie-parser');
  const { AppModule } = await import('../../apps/api/dist/app.module.js');
  const { SessionTokenService } = await import('../../apps/api/dist/auth/session-token.service.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const f = await fixtures();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.ownerId } });
    const session = await app.get(SessionTokenService).createSession(user);
    const { ACCESS_COOKIE_NAME } = await import('../../apps/api/dist/auth/auth.constants.js');
    const headers = { cookie: `${ACCESS_COOKIE_NAME}=${session.accessToken}` };
    const base = await app.getUrl();
    const response = await fetch(`${base}/api/photos/assets?limit=10`, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json()).items.map((row) => row.id),
      [f.photo.id],
    );
    assert.equal((await fetch(`${base}/api/eagle/assets/${f.photo.id}`, { headers })).status, 404);
    assert.equal(
      (await fetch(`${base}/api/photos/assets/${f.material.id}`, { headers })).status,
      404,
    );
    assert.equal((await fetch(`${base}/api/photos/assets`)).status, 401);
  } finally {
    await app.close();
  }
});
