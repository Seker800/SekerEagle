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

test('photo timeline and camera filters use captured metadata without exposing material records', async () => {
  const f = await fixtures();
  await prisma.eaglePhotoMetadata.create({
    data: {
      assetId: f.photo.id,
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetRevision: 0,
      processorVersion: 'test',
      cameraModel: 'Test Camera',
      capturedAt: new Date('2000-01-01T00:00:00Z'),
      latitude: 0,
      longitude: 0,
    },
  });
  await prisma.eagleAsset.update({
    where: { id: f.photo.id },
    data: { chronologicalAt: new Date('2000-01-01T00:00:00Z') },
  });
  const result = await f.photos.listAssets(f.ownerId, {
    limit: 10,
    cameraModel: 'Test Camera',
    gps: 'WITH',
  });
  assert.equal(result.items[0].photoMetadata.cameraModel, 'Test Camera');
  assert.equal(
    (await f.photos.listAssets(f.ownerId, { limit: 10, cameraModel: 'Another Camera' })).items
      .length,
    0,
  );
  await assert.rejects(
    () => f.materials.listAssets(f.ownerId, { limit: 10, cameraModel: 'Test Camera' }),
    /摄影/,
  );
});

test('people corrections remain owner-scoped and survive repeated model results', async () => {
  const { PhotoManagementService } =
    await import('../../apps/api/dist/photos/photo-management.service.js');
  const { persistPhotoFaces } = await import('../../apps/worker/dist/photo-faces.js');
  const f = await fixtures(),
    other = await fixtures();
  const service = new PhotoManagementService(prisma);
  const job = await prisma.eagleAssetProcessingJob.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetId: f.photo.id,
      assetRevision: 0,
      kind: 'ANALYZE_PHOTO_FACES',
      status: 'PROCESSING',
      leaseVersion: 1,
    },
  });
  const embedding = Array.from({ length: 128 }, (_, index) => (index === 0 ? 1 : 0));
  await persistPhotoFaces(prisma, job, [
    { box: [0.1, 0.2, 0.2, 0.2], confidence: 0.99, embedding },
  ]);
  const person = (await service.people(f.ownerId, false)).people[0];
  assert.ok(person);
  assert.ok(!JSON.stringify(person).includes('embedding'));
  await assert.rejects(
    () => service.renamePerson(other.ownerId, person.id, 'cross-owner', false),
    NotFoundException,
  );
  await service.renamePerson(f.ownerId, person.id, 'Test person', false);
  const corrected = await service.reassignFace(f.ownerId, person.faces[0].id, null, false);
  const replay = await prisma.eagleAssetProcessingJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING', leaseVersion: 2 },
  });
  await persistPhotoFaces(prisma, replay, [
    { box: [0.1, 0.2, 0.2, 0.2], confidence: 0.99, embedding },
  ]);
  assert.equal(
    (await prisma.eaglePhotoFace.findUniqueOrThrow({ where: { id: person.faces[0].id } })).personId,
    corrected.id,
  );
  await prisma.eagleAsset.update({ where: { id: f.photo.id }, data: { isPrivate: true } });
  assert.equal((await service.people(f.ownerId, false)).people.length, 0);
  assert.equal((await service.people(f.ownerId, true)).people.length, 1);
});

test('photo group choices survive rescans and cannot include material assets', async () => {
  const { PhotoManagementService } =
    await import('../../apps/api/dist/photos/photo-management.service.js');
  const f = await fixtures(),
    other = await fixtures();
  const service = new PhotoManagementService(prisma);
  const { aspectRatio: _computed, ...data } = f.photo;
  void _computed;
  const second = await prisma.eagleAsset.create({
    data: {
      ...data,
      id: randomUUID(),
      originalObjectKey: `users/${f.ownerId}/assets/${randomUUID()}/second.jpg`,
    },
  });
  for (const [index, asset] of [f.photo, second].entries())
    await prisma.eaglePhotoMetadata.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        assetId: asset.id,
        assetRevision: 0,
        processorVersion: 'test',
        cameraModel: 'test',
        capturedAt: new Date(10000 + index * 1000),
        perceptualHash: '0000000000000000',
        sharpnessScore: index + 1,
      },
    });
  assert.equal((await service.scanGroups(f.ownerId, false)).created, 1);
  const group = (await service.groups(f.ownerId, false))[0];
  assert.equal(group.bestAssetId, second.id);
  await assert.rejects(
    () => service.updateGroup(other.ownerId, group.id, { dismissed: true }, false),
    NotFoundException,
  );
  await assert.rejects(
    () => service.updateGroup(f.ownerId, group.id, { bestAssetId: f.material.id }, false),
    NotFoundException,
  );
  await service.updateGroup(f.ownerId, group.id, { bestAssetId: f.photo.id }, false);
  await service.scanGroups(f.ownerId, false);
  assert.equal((await service.groups(f.ownerId, false))[0].bestAssetId, f.photo.id);
  await service.updateGroup(f.ownerId, group.id, { dismissed: true }, false);
  await service.scanGroups(f.ownerId, false);
  assert.equal((await service.groups(f.ownerId, false)).length, 0);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'PHOTO' } }),
    2,
  );
});

test('processing update batches cannot disclose the other library', async () => {
  const f = await fixtures();
  assert.deepEqual(await f.materials.listUpdates(f.ownerId, [f.photo.id]), []);
  assert.deepEqual(await f.photos.listUpdates(f.ownerId, [f.material.id]), []);
  assert.deepEqual(
    (await f.photos.listUpdates(f.ownerId, [f.photo.id, f.material.id])).map((row) => row.id),
    [f.photo.id],
  );
});

test('manual photo grouping, merging and removing members keep originals and reject other scopes', async () => {
  const { PhotoManagementService } =
    await import('../../apps/api/dist/photos/photo-management.service.js');
  const f = await fixtures(),
    other = await fixtures(),
    service = new PhotoManagementService(prisma);
  const { aspectRatio: _generated, ...data } = f.photo;
  void _generated;
  const second = await prisma.eagleAsset.create({
    data: {
      ...data,
      id: randomUUID(),
      originalObjectKey: `users/${f.ownerId}/assets/${randomUUID()}/manual.jpg`,
    },
  });
  await assert.rejects(
    () => service.createGroup(f.ownerId, [f.photo.id, f.material.id], false),
    NotFoundException,
  );
  await assert.rejects(
    () => service.createGroup(f.ownerId, [f.photo.id, other.photo.id], false),
    NotFoundException,
  );
  const a = await service.createGroup(f.ownerId, [f.photo.id, second.id], false),
    b = await service.createGroup(f.ownerId, [f.photo.id, second.id], false);
  await service.mergeGroups(f.ownerId, a.id, b.id, false);
  assert.equal((await service.groups(f.ownerId, false)).length, 1);
  await assert.rejects(
    () => service.removeGroupMembers(other.ownerId, b.id, [f.photo.id], false),
    NotFoundException,
  );
  await service.removeGroupMembers(f.ownerId, b.id, [f.photo.id], false);
  assert.equal((await service.groups(f.ownerId, false)).length, 0);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'PHOTO' } }),
    2,
  );
});

test('replacing a photo invalidates automatic projections while retaining human records', async () => {
  const { PhotoRevisionObserver } =
    await import('../../apps/api/dist/photos/photo-revision.observer.js');
  const f = await fixtures();
  await prisma.eaglePhotoMetadata.create({
    data: {
      assetId: f.photo.id,
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetRevision: 0,
      processorVersion: 'test',
    },
  });
  const vector = Array.from({ length: 128 }, (_, index) => (index === 0 ? 1 : 0));
  const person = await prisma.eaglePhotoPerson.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      modelVersion: 'test',
      prototype: vector,
      name: 'Human name',
    },
  });
  await prisma.eaglePhotoFace.create({
    data: {
      id: randomUUID(),
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetId: f.photo.id,
      assetRevision: 0,
      modelVersion: 'test',
      personId: person.id,
      box: [0, 0, 1, 1],
      confidence: 1,
      embedding: vector,
      userAssigned: true,
    },
  });
  await prisma.$transaction((tx) =>
    new PhotoRevisionObserver().onOriginalReplaced(
      tx,
      { ownerId: f.ownerId, libraryMode: 'PHOTO' },
      f.photo.id,
    ),
  );
  assert.equal(await prisma.eaglePhotoMetadata.count({ where: { assetId: f.photo.id } }), 0);
  assert.equal(
    await prisma.eaglePhotoFace.count({ where: { assetId: f.photo.id, isCurrent: true } }),
    0,
  );
  assert.equal(
    (await prisma.eaglePhotoPerson.findUniqueOrThrow({ where: { id: person.id } })).name,
    'Human name',
  );
});

test('privacy display duration is an independent per-library preference', async () => {
  const { PrivacyVisibilityService } =
    await import('../../apps/api/dist/auth/privacy-visibility.service.js');
  const f = await fixtures();
  const service = new PrivacyVisibilityService(
    prisma,
    { signAsync: async () => 'test-only' },
    { getOrThrow: () => 'http://localhost:8180' },
  );
  const response = { clearCookie: () => {} };
  await service.update(f.ownerId, response, { enabled: false, durationHours: 1 }, 'MATERIAL');
  await service.update(f.ownerId, response, { enabled: false, durationHours: 12 }, 'PHOTO');
  assert.equal((await service.getStatus(f.ownerId, {}, 'MATERIAL')).durationHours, 1);
  assert.equal((await service.getStatus(f.ownerId, {}, 'PHOTO')).durationHours, 12);
});
