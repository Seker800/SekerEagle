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
    assert.equal((await fetch(`${base}/api/photos/assets/${f.photo.id}/location`)).status, 401);
    const location = await fetch(`${base}/api/photos/assets/${f.photo.id}/location`, { headers });
    assert.equal(location.status, 200);
    assert.equal((await location.json()).assetId, f.photo.id);
    assert.equal(
      (await fetch(`${base}/api/eagle/assets/${f.photo.id}/location`, { headers })).status,
      404,
    );
    assert.equal((await fetch(`${base}/api/photos/assets`)).status, 401);
    assert.equal((await fetch(`${base}/api/photos/photography/timeline`)).status, 401);
    const timelineResponse = await fetch(`${base}/api/photos/photography/timeline`, { headers });
    assert.equal(timelineResponse.status, 200);
    assert.equal(
      (await timelineResponse.json()).months.reduce((sum, row) => sum + row.count, 0),
      1,
    );
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
  const sharedRules = {
    version: 2,
    conditions: [
      {
        id: 'camera-gps',
        match: 'ALL',
        result: 'MATCH',
        rules: [
          { id: 'camera', field: 'CAMERA_MODEL', operator: 'CONTAINS', value: 'Test' },
          { id: 'gps', field: 'GPS', operator: 'EQUALS', value: 'WITH' },
        ],
      },
    ],
  };
  assert.equal(
    (await f.photos.listAssets(f.ownerId, { limit: 10, rules: JSON.stringify(sharedRules) })).items
      .length,
    1,
  );
  assert.equal((await f.photos.countAssets(f.ownerId, sharedRules)).count, 1);
  const folder = await f.photos.createSmartFolder(f.ownerId, {
    name: 'Photo Camera',
    query: sharedRules,
  });
  assert.equal(
    (await f.photos.listAssets(f.ownerId, { limit: 10, smartFolderId: folder.id })).items.length,
    1,
  );
  await assert.rejects(() => f.materials.countAssets(f.ownerId, sharedRules), /摄影/);
  await assert.rejects(
    () =>
      f.materials.createSmartFolder(f.ownerId, { name: 'Invalid Photo Rules', query: sharedRules }),
    /摄影/,
  );

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

test('photo stack projection respects shared rules and private members', async () => {
  const f = await fixtures();
  const { PhotoManagementService } =
    await import('../../apps/api/dist/photos/photo-management.service.js');
  const photography = new PhotoManagementService(prisma);
  const other = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      originalName: 'stack-second.jpg',
      displayName: 'second',
      normalizedDisplayName: 'second',
      format: 'jpeg',
      mimeType: 'image/jpeg',
      byteSize: 1n,
      originalObjectKey: `test/${randomUUID()}`,
      lifecycleStatus: 'READY',
    },
  });
  const group = await photography.createGroup(f.ownerId, [f.photo.id, other.id], false);
  await photography.updateGroup(f.ownerId, group.id, { bestAssetId: other.id }, false);
  const page = await f.photos.listAssets(f.ownerId, { limit: 1 });
  assert.equal(page.photoStacks.length, 1);
  assert.equal(page.photoStacks[0].cover.id, other.id);
  assert.equal(page.photoStacks[0].assetIds.length, 2);
  const filtered = await f.photos.listAssets(f.ownerId, {
    limit: 10,
    rules: JSON.stringify({
      version: 2,
      conditions: [
        {
          id: 'one',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'name', field: 'NAME', operator: 'EQUALS', value: 'second' }],
        },
      ],
    }),
  });
  assert.equal(filtered.photoStacks.length, 0);
  await prisma.eagleAsset.update({ where: { id: other.id }, data: { isPrivate: true } });
  const hidden = await f.photos.listAssets(f.ownerId, { limit: 10 });
  assert.equal(hidden.photoStacks.length, 0);
  assert.equal(
    hidden.items.some((row) => row.id === other.id),
    false,
  );
  assert.equal((await f.materials.listAssets(f.ownerId, { limit: 10 })).photoStacks, undefined);
});

test('worker automatically groups new photographs and preserves a manually chosen cover', async () => {
  const f = await fixtures();
  const { groupAnalyzedPhoto } = await import('../../apps/worker/dist/photo-grouping.js');
  const metadata = async (assetId, second, score) =>
    prisma.eaglePhotoMetadata.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        assetId,
        assetRevision: 0,
        processorVersion: 'test',
        capturedAt: new Date(`2024-01-01T00:00:0${second}Z`),
        cameraModel: 'camera',
        perceptualHash: '0000000000000000',
        sharpnessScore: score,
      },
    });
  const add = () =>
    prisma.eagleAsset.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        originalName: 'next.jpg',
        displayName: 'next',
        normalizedDisplayName: 'next',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        originalObjectKey: `test/${randomUUID()}`,
        lifecycleStatus: 'READY',
      },
    });
  await metadata(f.photo.id, 0, 10);
  const second = await add();
  await metadata(second.id, 1, 20);
  await prisma.$transaction((tx) => groupAnalyzedPhoto(tx, f.ownerId, second.id));
  const group = await prisma.eaglePhotoGroup.findFirstOrThrow({ where: { ownerId: f.ownerId } });
  assert.equal(group.bestAssetId, second.id);
  await prisma.eaglePhotoGroup.update({
    where: { id: group.id },
    data: { bestAssetId: f.photo.id, bestSelectedByUser: true },
  });
  const third = await add();
  await metadata(third.id, 2, 100);
  await prisma.$transaction((tx) => groupAnalyzedPhoto(tx, f.ownerId, third.id));
  assert.equal(await prisma.eaglePhotoGroup.count({ where: { ownerId: f.ownerId } }), 1);
  const updated = await prisma.eaglePhotoGroup.findUniqueOrThrow({
    where: { id: group.id },
    include: { members: true },
  });
  assert.equal(updated.members.length, 3);
  assert.equal(updated.bestAssetId, f.photo.id);
  await prisma.eaglePhotoGroup.update({ where: { id: group.id }, data: { dismissed: true } });
  await prisma.$transaction((tx) => groupAnalyzedPhoto(tx, f.ownerId, third.id));
  assert.equal(await prisma.eaglePhotoGroup.count({ where: { ownerId: f.ownerId } }), 1);
});

test('direct image-vector retrieval isolates owner/mode/private/revisions and composes filters and cursors', async () => {
  const { EagleImageSearchService } =
    await import('../../apps/api/dist/eagle/eagle-image-search.service.js');
  const { Prisma } = await import('@prisma/client');
  const f = await fixtures(),
    other = await fixtures();
  const spaceId = 'qwen3-vl-embedding-2b-1024-v1',
    revision = '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda';
  const spaceData = {
    model: 'Qwen/Qwen3-VL-Embedding-2B',
    revision,
    dimensions: 1024,
    instructionVersion: 'image-retrieval-v1',
    preprocessingVersion: 'preview-webp-v1',
    normalized: true,
    isCurrent: true,
  };
  await prisma.eagleEmbeddingSpace.upsert({
    where: { id: spaceId },
    create: { id: spaceId, ...spaceData },
    update: spaceData,
  });
  const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0)),
    literal = `[${vector.join(',')}]`;
  async function embed(asset, assetRevision = 0) {
    await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent",embedding,"updatedAt")
    VALUES (${randomUUID()},${asset.ownerId},${asset.libraryMode}::"LibraryMode",${asset.id},${assetRevision},${spaceId},'READY',true,${literal}::vector,now())`);
  }
  await embed(f.material);
  await embed(f.photo);
  await embed(other.material);
  const hidden = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'hidden.jpg',
      displayName: 'hidden',
      normalizedDisplayName: 'hidden',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      originalObjectKey: `test/${randomUUID()}`,
      isPrivate: true,
      lifecycleStatus: 'READY',
    },
  });
  await embed(hidden);
  const stale = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'stale.jpg',
      displayName: 'stale',
      normalizedDisplayName: 'stale',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      originalObjectKey: `test/${randomUUID()}`,
      mediaRevision: 1,
      lifecycleStatus: 'READY',
    },
  });
  await embed(stale, 0);
  const second = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'second.jpg',
      displayName: 'second',
      normalizedDisplayName: 'second',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      originalObjectKey: `test/${randomUUID()}`,
      rating: 5,
      lifecycleStatus: 'READY',
    },
  });
  await embed(second);
  let textCalls = 0;
  const client = {
    embedText: async () => {
      textCalls++;
      return { embedding: vector, revision };
    },
  };
  const search = new EagleImageSearchService(prisma, client, 'MATERIAL');
  const materials = new EagleService(prisma, search, 'MATERIAL');
  const photos = new EagleService(
    prisma,
    new EagleImageSearchService(prisma, client, 'PHOTO'),
    'PHOTO',
  );
  const first = await materials.listAssets(f.ownerId, { limit: 1, search: '海边' });
  assert.ok(first.nextCursor);
  assert.equal(first.imageSearch.status, 'READY');
  const next = await materials.listAssets(f.ownerId, {
    limit: 1,
    search: '海边',
    cursor: first.nextCursor,
  });
  assert.notEqual(first.items[0].id, next.items[0].id);
  assert.equal(textCalls, 1);
  assert.deepEqual(
    new Set([...first.items, ...next.items].map((row) => row.id)),
    new Set([f.material.id, second.id]),
  );
  assert.deepEqual(
    (await photos.listAssets(f.ownerId, { limit: 10, search: '海边' })).items.map((row) => row.id),
    [f.photo.id],
  );
  const rules = {
    version: 2,
    conditions: [
      {
        id: 'rating',
        match: 'ALL',
        result: 'MATCH',
        rules: [{ id: 'five', field: 'RATING', operator: 'EQUALS', value: '5' }],
      },
    ],
  };
  assert.deepEqual(
    (
      await materials.listAssets(f.ownerId, {
        limit: 10,
        search: '海边',
        rules: JSON.stringify(rules),
      })
    ).items.map((row) => row.id),
    [second.id],
  );
  await assert.rejects(
    () =>
      materials.listAssets(
        f.ownerId,
        { limit: 1, search: '海边', cursor: first.nextCursor, privacy: 'PRIVATE' },
        { includePrivate: true },
      ),
    /游标/,
  );
  await assert.rejects(
    () => photos.listAssets(f.ownerId, { limit: 1, search: '海边', cursor: first.nextCursor }),
    /游标/,
  );
  await assert.rejects(
    () =>
      materials.listAssets(other.ownerId, { limit: 1, search: '海边', cursor: first.nextCursor }),
    /游标/,
  );
  const { PhotoManagementService } =
    await import('../../apps/api/dist/photos/photo-management.service.js');
  const createPhoto = (name) =>
    prisma.eagleAsset.create({
      data: {
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        originalName: `${name}.jpg`,
        displayName: name,
        normalizedDisplayName: name,
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        originalObjectKey: `test/${randomUUID()}`,
        lifecycleStatus: 'READY',
      },
    });
  const matching = await createPhoto('matching'),
    unrelated = await createPhoto('unrelated');
  await embed(matching);
  const photography = new PhotoManagementService(prisma);
  const group = await photography.createGroup(
    f.ownerId,
    [f.photo.id, matching.id, unrelated.id],
    false,
  );
  await photography.updateGroup(f.ownerId, group.id, { bestAssetId: unrelated.id }, false);
  const photoMatches = await photos.listAssets(f.ownerId, { limit: 10, search: '海边' });
  assert.equal(photoMatches.photoStacks.length, 1);
  assert.deepEqual(
    new Set(photoMatches.photoStacks[0].assetIds),
    new Set([f.photo.id, matching.id]),
  );
  assert.notEqual(photoMatches.photoStacks[0].cover.id, unrelated.id);
  const offline = new EagleService(
    prisma,
    new EagleImageSearchService(
      prisma,
      {
        embedText: async () => {
          throw new Error('offline');
        },
      },
      'MATERIAL',
    ),
    'MATERIAL',
  );
  const lexical = await offline.listAssets(f.ownerId, { limit: 10, search: 'sample' });
  assert.equal(lexical.imageSearch.status, 'UNAVAILABLE');
  assert.deepEqual(
    lexical.items.map((row) => row.id),
    [f.material.id],
  );
});

test('full photo month index excludes other owners, materials, trash and hidden photos and seeks beyond page one', async () => {
  const { PhotoManagementService } =
    await import('../../apps/api/dist/photos/photo-management.service.js');
  const f = await fixtures(),
    foreign = await fixtures();
  await prisma.eagleAsset.update({
    where: { id: f.photo.id },
    data: { chronologicalAt: new Date('2001-01-05T12:00:00Z') },
  });
  const seed = (index, date, extra = {}) => ({
    id: randomUUID(),
    ownerId: f.ownerId,
    libraryMode: 'PHOTO',
    originalName: 'date.jpg',
    displayName: 'date',
    normalizedDisplayName: 'date',
    mimeType: 'image/jpeg',
    format: 'jpeg',
    byteSize: 1,
    originalObjectKey: `users/${f.ownerId}/timeline/${index}`,
    chronologicalAt: new Date(date),
    ...extra,
  });
  await prisma.eagleAsset.createMany({
    data: [
      ...Array.from({ length: 65 }, (_, i) => seed(i, '2024-03-01T12:00:00Z')),
      seed('private', '1980-01-01T00:00:00Z', { isPrivate: true }),
      seed('trash', '1970-01-01T00:00:00Z', { deletedAt: new Date() }),
      seed('foreign', '1960-01-01T00:00:00Z', { ownerId: foreign.ownerId }),
      seed('material', '1950-01-01T00:00:00Z', { libraryMode: 'MATERIAL' }),
    ],
  });
  const service = new PhotoManagementService(prisma);
  const index = await service.timeline(f.ownerId, false);
  assert.deepEqual(
    index.months.map((row) => [row.month, row.count]),
    [
      ['2024-03', 65],
      ['2001-01', 1],
    ],
  );
  const firstPage = await f.photos.listAssets(f.ownerId, { limit: 10 });
  assert.equal(
    firstPage.items.some((row) => row.id === f.photo.id),
    false,
  );
  const older = await f.photos.listAssets(f.ownerId, { limit: 10, cursor: index.months[1].cursor });
  assert.deepEqual(
    older.items.map((row) => row.id),
    [f.photo.id],
  );
  const visiblePrivate = await service.timeline(f.ownerId, true);
  assert.deepEqual(
    visiblePrivate.months.map((row) => row.month),
    ['2024-03', '2001-01', '1980-01'],
  );
  await assert.rejects(() =>
    f.materials.listAssets(f.ownerId, { limit: 10, cursor: index.months[1].cursor }),
  );
});

test('Live Photo pairs enforce scope, privacy, uniqueness, revision and component lifecycle', async () => {
  const f = await fixtures();
  const foreign = await fixtures();
  const identifier = randomUUID();
  await prisma.eagleAsset.update({
    where: { id: f.photo.id },
    data: { livePhotoIdentifier: identifier, livePhotoRole: 'STILL' },
  });
  const movie = async (ownerId, libraryMode) => {
    const id = randomUUID();
    return prisma.eagleAsset.create({
      data: {
        id,
        ownerId,
        libraryMode,
        originalName: 'live.mov',
        displayName: 'live',
        normalizedDisplayName: 'live',
        mimeType: 'video/quicktime',
        format: 'mov',
        mediaRevision: 1,
        byteSize: 1,
        originalObjectKey: `users/${ownerId}/assets/${id}/original.mov`,
        lifecycleStatus: 'READY',
        livePhotoIdentifier: identifier,
        livePhotoRole: 'MOTION',
        renditions: {
          create: {
            kind: 'PREVIEW',
            variant: 'default',
            revision: 1,
            storageKey: `users/${ownerId}/assets/${id}/preview.mp4`,
            mimeType: 'video/mp4',
            byteSize: 1,
            status: 'READY',
          },
        },
      },
    });
  };
  await movie(f.ownerId, 'MATERIAL');
  await movie(foreign.ownerId, 'PHOTO');
  const read = () => f.photos.getAsset(f.ownerId, f.photo.id);
  assert.equal((await read()).livePhotoMotion, undefined);
  const motion = await movie(f.ownerId, 'PHOTO');
  assert.equal((await read()).livePhotoMotion.assetId, motion.id);
  await prisma.eagleAsset.update({ where: { id: motion.id }, data: { isPrivate: true } });
  assert.equal((await read()).livePhotoMotion, undefined);
  await prisma.eagleAsset.update({
    where: { id: motion.id },
    data: { isPrivate: false, mediaRevision: 2 },
  });
  assert.equal((await read()).livePhotoMotion, undefined);
  await prisma.eagleAsset.update({ where: { id: motion.id }, data: { mediaRevision: 1 } });
  const duplicate = await movie(f.ownerId, 'PHOTO');
  assert.equal((await read()).livePhotoMotion, undefined);
  await prisma.eagleAsset.delete({ where: { id: duplicate.id } });
  assert.equal((await f.photos.setTrash(f.ownerId, [f.photo.id], false)).affectedAssetCount, 2);
  assert.equal((await f.photos.setTrash(f.ownerId, [f.photo.id], true)).affectedAssetCount, 2);
  assert.equal((await read()).livePhotoMotion.assetId, motion.id);
  assert.equal((await f.photos.setTrash(f.ownerId, [motion.id], false)).affectedAssetCount, 1);
  assert.equal((await read()).deletedAt, null);
  assert.equal((await read()).livePhotoMotion, undefined);
  assert.equal((await f.materials.listAssets(f.ownerId, { limit: 50 })).items.length, 2);
});

test('asset location seeks a bounded neighborhood and rejects foreign, private, trash and cross-library targets', async () => {
  const f = await fixtures();
  const foreign = await fixtures();
  for (const [mode, service, target] of [
    ['MATERIAL', f.materials, f.material],
    ['PHOTO', f.photos, f.photo],
  ]) {
    const base = new Date('2023-03-01T12:00:00Z');
    await prisma.eagleAsset.update({
      where: { id: target.id },
      data: { chronologicalAt: base, libraryAddedAt: base },
    });
    await prisma.eagleAsset.createMany({
      data: Array.from({ length: 90 }, (_, index) => {
        const id = randomUUID();
        const date = new Date(base.getTime() + (index < 80 ? index + 1 : -(index + 1)) * 1000);
        return {
          id,
          ownerId: f.ownerId,
          libraryMode: mode,
          originalName: 'nearby.jpg',
          displayName: 'nearby',
          normalizedDisplayName: 'nearby',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          originalObjectKey: `users/${f.ownerId}/assets/${id}/original.jpg`,
          chronologicalAt: date,
          libraryAddedAt: date,
        };
      }),
    });
    const location = await service.locateAsset(f.ownerId, target.id);
    assert.equal(location.assetId, target.id);
    const nearby = await service.listAssets(f.ownerId, { limit: 60, cursor: location.cursor });
    assert.equal(
      nearby.items.findIndex((row) => row.id === target.id),
      20,
    );
    assert.equal(nearby.items.length, 31);
    const other = mode === 'PHOTO' ? f.materials : f.photos;
    await assert.rejects(() => other.locateAsset(f.ownerId, target.id), NotFoundException);
    await assert.rejects(() => service.locateAsset(foreign.ownerId, target.id), NotFoundException);
    await assert.rejects(() => other.listAssets(f.ownerId, { limit: 60, cursor: location.cursor }));
    await prisma.eagleAsset.update({ where: { id: target.id }, data: { isPrivate: true } });
    await assert.rejects(() => service.locateAsset(f.ownerId, target.id), NotFoundException);
    assert.equal((await service.locateAsset(f.ownerId, target.id, true)).assetId, target.id);
    await prisma.eagleAsset.update({
      where: { id: target.id },
      data: { isPrivate: false, deletedAt: new Date() },
    });
    await assert.rejects(() => service.locateAsset(f.ownerId, target.id), NotFoundException);
  }
});

test('explicit sending creates independent targets, preserves privacy, removes sources and retries idempotently', async () => {
  const { EagleLibraryTransferService } =
    await import('../../apps/api/dist/eagle/eagle-library-transfer.service.js');
  const f = await fixtures();
  const copies = [];
  const storage = {
    copyObject: async (source, target) => copies.push([source, target]),
    headObject: async () => ({ ContentLength: 1 }),
  };
  const sender = new EagleLibraryTransferService(prisma, storage, 'MATERIAL');
  const tag = await f.materials.createManualTag(f.ownerId, { name: 'source-only' });
  await f.materials.replaceAssetTags(f.ownerId, f.material.id, [tag.id]);
  await prisma.eagleAsset.update({ where: { id: f.material.id }, data: { isPrivate: true } });
  const input = { operationId: randomUUID(), assetIds: [f.material.id] };
  await assert.rejects(() => sender.send(f.ownerId, input, false), NotFoundException);
  await assert.rejects(() => sender.send(randomUUID(), input, true), NotFoundException);
  await assert.rejects(
    () =>
      sender.send(
        f.ownerId,
        { operationId: randomUUID(), assetIds: [f.material.id, f.photo.id] },
        true,
      ),
    NotFoundException,
  );
  assert.equal(copies.length, 0);
  const result = await sender.send(f.ownerId, input, true);
  assert.equal(result.targetMode, 'PHOTO');
  assert.equal(result.movedCount, 1);
  const targetId = result.assets[0].assetId;
  const source = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.material.id } });
  const target = await prisma.eagleAsset.findUniqueOrThrow({
    where: { id: targetId },
    include: { manualTagLinks: true, processingJobs: true },
  });
  assert.equal(source.libraryMode, 'MATERIAL');
  assert.ok(source.deletedAt);
  assert.equal(target.libraryMode, 'PHOTO');
  assert.equal(target.isPrivate, true);
  assert.equal(target.manualTagLinks.length, 0);
  assert.notEqual(target.originalObjectKey, source.originalObjectKey);
  assert.ok(
    target.processingJobs.every((job) => job.libraryMode === 'PHOTO' && job.assetRevision === 1),
  );
  assert.deepEqual(await sender.send(f.ownerId, input, true), result);
  assert.equal(copies.length, 1);
  await assert.rejects(
    () => new EagleLibraryTransferService(prisma, storage, 'PHOTO').send(f.ownerId, input, true),
    NotFoundException,
  );
});

test('failed sends leave all sources active and retry the durable plan without duplicate targets', async () => {
  const { EagleLibraryTransferService } =
    await import('../../apps/api/dist/eagle/eagle-library-transfer.service.js');
  const f = await fixtures();
  const second = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'second.jpg',
      displayName: 'second',
      normalizedDisplayName: 'second',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      originalObjectKey: `users/${f.ownerId}/assets/${randomUUID()}/original.jpg`,
      lifecycleStatus: 'READY',
    },
  });
  let failed = true;
  let calls = 0;
  const storage = {
    copyObject: async () => {
      if (++calls === 2 && failed) throw new Error('temporary storage failure');
    },
    headObject: async () => ({ ContentLength: 1 }),
  };
  const sender = new EagleLibraryTransferService(prisma, storage, 'MATERIAL');
  const input = { operationId: randomUUID(), assetIds: [f.material.id, second.id] };
  await assert.rejects(() => sender.send(f.ownerId, input, false), /temporary/);
  assert.equal(
    await prisma.eagleAsset.count({
      where: { ownerId: f.ownerId, libraryMode: 'MATERIAL', deletedAt: null },
    }),
    2,
  );
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'PHOTO' } }),
    1,
  );
  const pending = await prisma.eagleLibraryTransfer.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  assert.equal(pending.status, 'PENDING');
  failed = false;
  const [a, b] = await Promise.all([
    sender.send(f.ownerId, input, false),
    sender.send(f.ownerId, input, false),
  ]);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.assets.map((row) => row.assetId)).size, 2);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'PHOTO' } }),
    3,
  );
  assert.equal(
    await prisma.eagleAsset.count({
      where: { ownerId: f.ownerId, libraryMode: 'MATERIAL', deletedAt: null },
    }),
    0,
  );
  assert.deepEqual(
    pending.plan.map((row) => row.targetId).sort(),
    a.assets.map((row) => row.assetId).sort(),
  );
});

test('sending an Apple Live Photo to materials moves both originals and keeps their jobs in the target mode', async () => {
  const { EagleLibraryTransferService } =
    await import('../../apps/api/dist/eagle/eagle-library-transfer.service.js');
  const f = await fixtures();
  const identifier = randomUUID();
  await prisma.eagleAsset.update({
    where: { id: f.photo.id },
    data: { livePhotoIdentifier: identifier, livePhotoRole: 'STILL' },
  });
  const movie = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      originalName: 'pair.mov',
      displayName: 'pair',
      normalizedDisplayName: 'pair',
      mimeType: 'video/quicktime',
      format: 'mov',
      byteSize: 1,
      mediaRevision: 1,
      originalObjectKey: `users/${f.ownerId}/assets/${randomUUID()}/original.mov`,
      lifecycleStatus: 'READY',
      livePhotoIdentifier: identifier,
      livePhotoRole: 'MOTION',
    },
  });
  await prisma.eagleAssetRendition.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetId: movie.id,
      kind: 'PREVIEW',
      revision: 1,
      storageKey: `users/${f.ownerId}/assets/${movie.id}/preview.mp4`,
      mimeType: 'video/mp4',
      byteSize: 1,
      status: 'READY',
    },
  });
  const storage = { copyObject: async () => {}, headObject: async () => ({ ContentLength: 1 }) };
  const result = await new EagleLibraryTransferService(prisma, storage, 'PHOTO').send(
    f.ownerId,
    { operationId: randomUUID(), assetIds: [f.photo.id] },
    false,
  );
  assert.equal(result.targetMode, 'MATERIAL');
  assert.equal(result.componentCount, 2);
  assert.equal(
    await prisma.eagleAsset.count({
      where: { ownerId: f.ownerId, libraryMode: 'PHOTO', deletedAt: null },
    }),
    0,
  );
  const targetIds = result.assets.map((row) => row.assetId);
  assert.equal(
    await prisma.eagleAsset.count({
      where: { id: { in: targetIds }, libraryMode: 'MATERIAL', mediaRevision: 1 },
    }),
    2,
  );
  const jobs = await prisma.eagleAssetProcessingJob.findMany({
    where: { assetId: { in: targetIds } },
  });
  assert.ok(jobs.some((job) => job.processorVersion === 'camera-video-preview-v2'));
  assert.ok(jobs.every((job) => job.libraryMode === 'MATERIAL'));
});

test('concurrent source edits or conflicting sends never publish duplicate targets or remove changed originals', async () => {
  const { EagleLibraryTransferService } =
    await import('../../apps/api/dist/eagle/eagle-library-transfer.service.js');
  const f = await fixtures();
  let copies = 0;
  const input = { operationId: randomUUID(), assetIds: [f.material.id] };
  const storage = {
    copyObject: async () => {
      copies++;
      await prisma.eagleAsset.update({
        where: { id: f.material.id },
        data: { rowVersion: { increment: 1 } },
      });
    },
    headObject: async () => ({ ContentLength: 1 }),
  };
  const sender = new EagleLibraryTransferService(prisma, storage, 'MATERIAL');
  await assert.rejects(() => sender.send(f.ownerId, input, false), /变化/);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.material.id } })).deletedAt,
    null,
  );
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'PHOTO' } }),
    1,
  );
  await assert.rejects(() => sender.send(f.ownerId, input, false), /变化/);
  assert.equal(copies, 1);
  storage.copyObject = async () => {};
  const results = await Promise.allSettled([
    sender.send(f.ownerId, { operationId: randomUUID(), assetIds: [f.material.id] }, false),
    sender.send(f.ownerId, { operationId: randomUUID(), assetIds: [f.material.id] }, false),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'PHOTO' } }),
    2,
  );
});

test('purge commits asset deletion and detached upload/capture pointers before retryable object cleanup', async () => {
  const { prepareAssetPurge, drainObjectDeletion } =
    await import('../../apps/worker/dist/asset-purge.js');
  const f = await fixtures();
  const privateAsset = await prisma.eagleAsset.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'MATERIAL',
      originalName: 'private.jpg',
      displayName: 'private',
      normalizedDisplayName: 'private',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1,
      originalObjectKey: `users/${f.ownerId}/private`,
      isPrivate: true,
      deletedAt: new Date(),
    },
  });
  await prisma.eagleAsset.updateMany({
    where: { id: { in: [f.material.id, f.photo.id] } },
    data: { deletedAt: new Date() },
  });
  const upload = await prisma.uploadSession.create({
    data: {
      uploaderId: f.ownerId,
      eagleAssetId: f.material.id,
      originalName: 'original.jpg',
      mimeType: 'image/jpeg',
      size: 1,
      objectKey: `users/${f.ownerId}/upload`,
      multipartUploadId: 'test-only',
      status: 'COMPLETED',
    },
  });
  await prisma.eagleUploadSessionState.create({
    data: {
      ownerId: f.ownerId,
      uploadSessionId: upload.id,
      assetId: f.material.id,
      replacementAssetId: f.material.id,
    },
  });
  const capture = await prisma.eagleBrowserCapture.create({
    data: {
      ownerId: f.ownerId,
      uploadSessionId: upload.id,
      assetId: f.material.id,
      clientCaptureId: randomUUID(),
      displayName: 'test',
      pageTitle: 'test',
      pageUrl: 'https://example.invalid',
      capturedAt: new Date(),
      extensionVersion: 'test',
    },
  });
  await prisma.eagleAssetProcessingJob.create({
    data: {
      ownerId: f.ownerId,
      assetId: f.material.id,
      kind: 'PURGE_ASSET',
      lane: 'MAINTENANCE',
      assetRevision: 1,
      status: 'COMPLETED',
    },
  });
  assert.equal((await f.materials.emptyTrash(f.ownerId)).affectedAssetCount, 1);
  assert.equal(
    (await prisma.eagleAsset.findUnique({ where: { id: privateAsset.id } })).purgeAfter,
    null,
  );
  assert.equal(
    (await prisma.eagleAsset.findUnique({ where: { id: f.photo.id } })).purgeAfter,
    null,
  );
  await assert.rejects(f.materials.setTrash(f.ownerId, [f.material.id], true), NotFoundException);
  const pending = await prisma.eagleAssetProcessingJob.findFirst({
    where: { assetId: f.material.id, kind: 'PURGE_ASSET' },
  });
  assert.equal(pending.status, 'PENDING');
  const job = await prisma.eagleAssetProcessingJob.update({
    where: { id: pending.id },
    data: { status: 'PROCESSING', leaseVersion: { increment: 1 } },
  });
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "PurgeFailureFixture" ("assetId" TEXT REFERENCES "EagleAsset"(id) ON DELETE RESTRICT)',
  );
  try {
    await prisma.$executeRaw`INSERT INTO "PurgeFailureFixture" VALUES (${f.material.id})`;
    await assert.rejects(prisma.$transaction((tx) => prepareAssetPurge(tx, job)));
    assert.ok(await prisma.eagleAsset.findUnique({ where: { id: f.material.id } }));
    assert.equal(await prisma.eagleObjectDeletion.count({ where: { ownerId: f.ownerId } }), 0);
    assert.equal(
      (await prisma.uploadSession.findUnique({ where: { id: upload.id } })).eagleAssetId,
      f.material.id,
    );
  } finally {
    await prisma.$executeRawUnsafe('DROP TABLE "PurgeFailureFixture"');
  }
  await prisma.$transaction((tx) => prepareAssetPurge(tx, job));
  assert.equal(await prisma.eagleAsset.findUnique({ where: { id: f.material.id } }), null);
  assert.equal(
    (await prisma.uploadSession.findUnique({ where: { id: upload.id } })).eagleAssetId,
    null,
  );
  assert.equal(
    (await prisma.eagleBrowserCapture.findUnique({ where: { id: capture.id } })).assetId,
    null,
  );
  const state = await prisma.eagleUploadSessionState.findUnique({
    where: { uploadSessionId: upload.id },
  });
  assert.equal(state.assetId, null);
  assert.equal(state.replacementAssetId, null);
  // Other owners' outboxes are not present in this isolated fixture, and no real S3 is used.
  const deletion = await prisma.eagleObjectDeletion.findFirst({ where: { ownerId: f.ownerId } });
  assert.ok(deletion.objectKeys.includes(f.material.originalObjectKey));
  await drainObjectDeletion(prisma, {
    deleteObject: async () => {
      throw new Error('test storage offline');
    },
    deletePrefix: async () => {},
  });
  assert.equal(
    (await prisma.eagleObjectDeletion.findUnique({ where: { id: deletion.id } })).status,
    'PENDING',
  );
  await prisma.eagleObjectDeletion.update({
    where: { id: deletion.id },
    data: { availableAt: new Date(0) },
  });
  const removed = [];
  await drainObjectDeletion(prisma, {
    deleteObject: async (key) => {
      removed.push(key);
    },
    deletePrefix: async () => {},
  });
  assert.ok(removed.includes(f.material.originalObjectKey));
  assert.equal(await prisma.eagleObjectDeletion.findUnique({ where: { id: deletion.id } }), null);
});
