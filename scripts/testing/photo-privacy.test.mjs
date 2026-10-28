import { performance } from 'node:perf_hooks';
import { log } from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, after } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import {
  syncAssetPrivacy,
  inheritedPrivacyTag,
} from '../../packages/library-persistence/dist/index.js';
import { PhotoManagementService } from '../../apps/api/dist/photos/photo-management.service.js';
import { EaglePrivacyService } from '../../apps/api/dist/eagle/eagle-privacy.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { persistPhotoFaces, FACE_MODEL_VERSION } from '../../apps/worker/dist/photo-faces.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());
const embedding = [1, ...Array(127).fill(0)];
async function fixture() {
  const ownerId = randomUUID();
  await prisma.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'test-only' },
  });
  const add = (more = {}) =>
    prisma.eagleAsset.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        originalName: 'privacy-test.jpg',
        displayName: 'privacy sample',
        normalizedDisplayName: 'privacy sample',
        mimeType: 'image/jpeg',
        format: 'jpg',
        byteSize: 1,
        originalObjectKey: `test/${randomUUID()}`,
        lifecycleStatus: 'READY',
        ...more,
      },
    });
  const a = await add(),
    b = await add(),
    publicAsset = await add();
  const person = await prisma.eaglePhotoPerson.create({
    data: { ownerId, name: '测试人物', prototype: embedding, modelVersion: FACE_MODEL_VERSION },
  });
  const face = await prisma.eaglePhotoFace.create({
    data: {
      id: randomUUID(),
      ownerId,
      assetId: a.id,
      assetRevision: a.mediaRevision,
      modelVersion: FACE_MODEL_VERSION,
      personId: person.id,
      box: [0.1, 0.1, 0.4, 0.4],
      confidence: 1,
      embedding,
    },
  });
  const service = new PhotoManagementService(prisma),
    tags = new EaglePrivacyService(prisma, 'PHOTO'),
    assets = new EagleService(prisma, undefined, 'PHOTO');
  const marked = () => prisma.eagleAsset.findUniqueOrThrow({ where: { id: a.id } });
  const rule = async (value, includePrivate = true, id = person.id) => {
    const p = await prisma.eaglePhotoPerson.findUniqueOrThrow({ where: { id } });
    return service.setPersonPrivacy(ownerId, id, value, p.rowVersion, includePrivate);
  };
  return { ownerId, a, b, publicAsset, add, person, face, service, tags, assets, marked, rule };
}
test('人物规则隐藏照片，标签取消不解除人物保护，公开时才解除全部保护', async () => {
  const f = await fixture();
  const tag = await prisma.eagleManualTag.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      name: '私密测试',
      normalizedName: '私密测试',
    },
  });
  await prisma.eagleAssetManualTag.create({
    data: { ownerId: f.ownerId, libraryMode: 'PHOTO', assetId: f.a.id, tagId: tag.id },
  });
  const result = await f.rule(true, false);
  assert.equal(result.changed, 1);
  await f.tags.updateSettings(f.ownerId, {
    expectedTagIds: (await f.tags.getSettings(f.ownerId)).tagIds,
    tagIds: [tag.id],
  });
  await f.tags.updateSettings(f.ownerId, {
    expectedTagIds: (await f.tags.getSettings(f.ownerId)).tagIds,
    tagIds: [],
  });
  assert.equal((await f.marked()).isPrivate, true);
  await f.tags.updateSettings(f.ownerId, {
    expectedTagIds: (await f.tags.getSettings(f.ownerId)).tagIds,
    tagIds: [tag.id],
  });
  await f.rule(false);
  assert.equal((await f.marked()).isPrivate, true);
  await f.tags.updateSettings(f.ownerId, {
    expectedTagIds: (await f.tags.getSettings(f.ownerId)).tagIds,
    tagIds: [],
  });
  assert.equal((await f.marked()).isPrivate, false);
});
test('重复投影不改变版本，过期人物版本冲突且跨用户不可修改', async () => {
  const f = await fixture();
  await f.rule(true);
  const version = (await f.marked()).rowVersion;
  await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, [f.a.id], 'PHOTO'));
  assert.equal((await f.marked()).rowVersion, version);
  await assert.rejects(f.service.setPersonPrivacy(f.ownerId, f.person.id, false, 1, true), /变化/);
  await assert.rejects(
    f.service.setPersonPrivacy(randomUUID(), f.person.id, false, 2, true),
    /不存在/,
  );
  await assert.rejects(f.rule(false, false), /不存在/);
  assert.equal((await f.marked()).isPrivate, true);
});
test('私密人物合并到公开人物保留规则，目标原有照片同时隐藏', async () => {
  const f = await fixture();
  await f.rule(true);
  const target = await prisma.eaglePhotoPerson.create({
    data: { ownerId: f.ownerId, prototype: embedding, modelVersion: FACE_MODEL_VERSION },
  });
  await prisma.eaglePhotoFace.create({
    data: {
      id: randomUUID(),
      ownerId: f.ownerId,
      assetId: f.b.id,
      assetRevision: 0,
      modelVersion: FACE_MODEL_VERSION,
      personId: target.id,
      box: [0, 0, 1, 1],
      confidence: 1,
      embedding,
    },
  });
  await f.service.mergePeople(f.ownerId, f.person.id, target.id, true);
  assert.equal(
    (await prisma.eaglePhotoPerson.findUniqueOrThrow({ where: { id: target.id } }))
      .marksAssetsPrivate,
    true,
  );
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, isPrivate: true } }),
    2,
  );
  await assert.rejects(f.service.mergePeople(f.ownerId, target.id, randomUUID(), true), /不存在/);
});
test('人脸纠错仅解除该人物原因，私密标签继续保护', async () => {
  const f = await fixture();
  await f.rule(true);
  const tagId = await prisma.$transaction((tx) => inheritedPrivacyTag(tx, f.ownerId, 'PHOTO'));
  await prisma.eagleAssetManualTag.create({
    data: { ownerId: f.ownerId, libraryMode: 'PHOTO', assetId: f.a.id, tagId },
  });
  const split = await f.service.reassignFace(f.ownerId, f.face.id, null, true);
  assert.notEqual(split.id, f.person.id);
  assert.equal((await f.marked()).isPrivate, true);
  await f.tags.updateSettings(f.ownerId, {
    expectedTagIds: (await f.tags.getSettings(f.ownerId)).tagIds,
    tagIds: [],
  });
  assert.equal((await f.marked()).isPrivate, false);
  await f.service.reassignFace(f.ownerId, f.face.id, f.person.id, true);
  assert.equal((await f.marked()).isPrivate, true);
});
test('实况配对包括迟到视频继承保护，模式和其他用户保持隔离', async () => {
  const f = await fixture(),
    id = randomUUID();
  await prisma.eagleAsset.update({
    where: { id: f.a.id },
    data: { livePhotoIdentifier: id, livePhotoRole: 'STILL' },
  });
  await f.rule(true);
  const movie = await f.add({
    livePhotoIdentifier: id,
    livePhotoRole: 'MOTION',
    mimeType: 'video/quicktime',
  });
  const material = await f.add({
    libraryMode: 'MATERIAL',
    livePhotoIdentifier: id,
    livePhotoRole: 'MOTION',
  });
  await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, [movie.id], 'PHOTO'));
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: movie.id } })).isPrivate,
    true,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: material.id } })).isPrivate,
    false,
  );
  await f.rule(false);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: movie.id } })).isPrivate,
    false,
  );
});
test('过期人脸不命中规则，合照任一私密人物即可保护', async () => {
  const f = await fixture();
  await f.rule(true);
  await prisma.eaglePhotoFace.update({ where: { id: f.face.id }, data: { assetRevision: 99 } });
  await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, [f.a.id], 'PHOTO'));
  assert.equal((await f.marked()).isPrivate, false);
  await prisma.eaglePhotoFace.update({ where: { id: f.face.id }, data: { assetRevision: 0 } });
  await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, [f.a.id], 'PHOTO'));
  assert.equal((await f.marked()).isPrivate, true);
});
test('后台识别新增照片自动继承人物私密，人工纠错跨模型重跑保留', async () => {
  const f = await fixture();
  await f.rule(true);
  const job = await prisma.eagleAssetProcessingJob.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetId: f.b.id,
      assetRevision: 0,
      kind: 'ANALYZE_PHOTO_FACES',
      processorVersion: FACE_MODEL_VERSION,
      status: 'PROCESSING',
    },
  });
  await persistPhotoFaces(prisma, job, [{ box: [0.1, 0.1, 0.4, 0.4], confidence: 1, embedding }]);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.b.id } })).isPrivate,
    true,
  );
  await prisma.eaglePhotoFace.update({
    where: { id: f.face.id },
    data: { userAssigned: true, modelVersion: 'previous-model' },
  });
  const rerun = await prisma.eagleAssetProcessingJob.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetId: f.a.id,
      assetRevision: 0,
      kind: 'ANALYZE_PHOTO_FACES',
      processorVersion: FACE_MODEL_VERSION,
      status: 'PROCESSING',
    },
  });
  await persistPhotoFaces(prisma, rerun, [
    { box: [0.11, 0.1, 0.4, 0.4], confidence: 1, embedding },
  ]);
  assert.equal(
    await prisma.eaglePhotoFace.count({ where: { assetId: f.a.id, isCurrent: true } }),
    1,
  );
  assert.equal((await f.marked()).isPrivate, true);
});
test('列表、人物、时间索引和详情统一过滤，授权详情解释私密原因', async () => {
  const f = await fixture();
  await f.rule(true);
  assert.equal((await f.service.people(f.ownerId, false)).people.length, 0);
  assert.equal((await f.service.people(f.ownerId, true)).people[0].marksAssetsPrivate, true);
  assert.equal(
    (await f.assets.listAssets(f.ownerId, { limit: 50 })).items.some((a) => a.id === f.a.id),
    false,
  );
  await assert.rejects(f.assets.getAsset(f.ownerId, f.a.id), /不存在/);
  const detail = await f.assets.getAsset(f.ownerId, f.a.id, { includePrivate: true });
  assert.deepEqual(detail.privacyReasons, [{ kind: 'PERSON', id: f.person.id, name: '测试人物' }]);
  assert.equal(
    (await f.service.timeline(f.ownerId, false)).months.reduce((n, m) => n + m.count, 0),
    2,
  );
});
test('真实 HTTP 私密规则拒绝匿名、PAT、跨用户、跨模式和过期版本；媒体与 Agent 不泄露', async () => {
  const defaults = {
    NODE_ENV: 'test',
    PORT: '3000',
    CANONICAL_ORIGIN: 'http://localhost:8180',
    JWT_ACCESS_SECRET: 'isolated-privacy-test-signing-key-over-32-characters',
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
  const { PatService } = await import('../../apps/api/dist/auth/pat.service.js');
  const { SessionTokenService } = await import('../../apps/api/dist/auth/session-token.service.js');
  const { PrivacyVisibilityService } =
    await import('../../apps/api/dist/auth/privacy-visibility.service.js');
  const { ACCESS_COOKIE_NAME } = await import('../../apps/api/dist/auth/auth.constants.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(),
      f = await fixture();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.ownerId } });
    const session = await app.get(SessionTokenService).createSession(user);
    const auth = {
      cookie: `${ACCESS_COOKIE_NAME}=${session.accessToken}`,
      origin: defaults.CANONICAL_ORIGIN,
      'content-type': 'application/json',
    };
    const settingsUrl = `${base}/api/photos/privacy-settings`;
    assert.equal(
      (
        await fetch(settingsUrl, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({ tagIds: [] }),
        })
      ).status,
      400,
    );
    const loadedRules = await (await fetch(settingsUrl, { headers: auth })).json();
    const inheritedTagId = await prisma.$transaction((tx) =>
      inheritedPrivacyTag(tx, f.ownerId, 'PHOTO'),
    );
    await prisma.eagleAssetManualTag.create({
      data: { ownerId: f.ownerId, libraryMode: 'PHOTO', assetId: f.b.id, tagId: inheritedTagId },
    });
    await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, undefined, 'PHOTO'));
    assert.equal(
      (
        await fetch(settingsUrl, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({ tagIds: [], expectedTagIds: loadedRules.tagIds }),
        })
      ).status,
      409,
    );
    assert.equal(
      (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.b.id } })).isPrivate,
      true,
    );
    const currentRules = await (await fetch(settingsUrl, { headers: auth })).json();
    const savedRules = await fetch(settingsUrl, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ tagIds: currentRules.tagIds, expectedTagIds: currentRules.tagIds }),
    });
    assert.equal(savedRules.status, 200);
    assert.deepEqual(await savedRules.json(), currentRules);
    assert.equal(
      (
        await fetch(`${base}/api/eagle/privacy-settings`, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({ tagIds: currentRules.tagIds, expectedTagIds: [] }),
        })
      ).status,
      404,
    );
    const url = `${base}/api/photos/photography/people/${f.person.id}/privacy`;
    const body = { marksAssetsPrivate: true, rowVersion: 1 };
    const patch = async (headers, payload = body, path = url) => {
      // Exercise all guards without exhausting the production short-window limiter.
      await delay(150);
      return fetch(path, { method: 'PATCH', headers, body: JSON.stringify(payload) });
    };
    assert.equal((await patch({ 'content-type': 'application/json' })).status, 401);
    const pat = await app.get(PatService).create(f.ownerId, 'privacy-read', ['photo:read']);
    const bearer = { authorization: `Bearer ${pat.token}`, 'content-type': 'application/json' };
    assert.equal((await patch(bearer)).status, 403);
    assert.equal((await patch({ ...auth, origin: 'https://invalid.example' })).status, 403);
    assert.equal((await patch(auth, { ...body, ownerId: randomUUID() })).status, 400);
    assert.equal((await patch(auth, { ...body, marksAssetsPrivate: 'true' })).status, 400);
    assert.equal((await patch(auth, { ...body, rowVersion: 0 })).status, 400);
    assert.equal(
      (await patch(auth, body, `${base}/api/eagle/photography/people/${f.person.id}/privacy`))
        .status,
      404,
    );
    const foreign = await fixture();
    assert.equal(
      (
        await patch(
          auth,
          body,
          `${base}/api/photos/photography/people/${foreign.person.id}/privacy`,
        )
      ).status,
      404,
    );
    const marked = await patch(auth);
    assert.equal(marked.status, 200, await marked.text());
    assert.equal((await patch(auth, { marksAssetsPrivate: false, rowVersion: 2 })).status, 404);
    for (const suffix of [
      '',
      '/original',
      '/content',
      `/renditions/${randomUUID()}/content`,
      '/pyramid',
    ]) {
      assert.equal(
        (await fetch(`${base}/api/photos/assets/${f.a.id}${suffix}`, { headers: auth })).status,
        404,
        suffix,
      );
    }
    const visible = await (
      await fetch(`${base}/api/photos/agent/photos`, { headers: bearer })
    ).json();
    assert.equal(
      visible.items.some((a) => a.id === f.a.id),
      false,
    );
    let grantCookie;
    await app.get(PrivacyVisibilityService).update(
      f.ownerId,
      {
        cookie: (name, token) => {
          grantCookie = `${name}=${token}`;
        },
      },
      { enabled: true, durationHours: 1 },
      'PHOTO',
    );
    const privateAuth = { ...auth, cookie: `${auth.cookie}; ${grantCookie}` };
    assert.equal(
      (await patch(privateAuth, { marksAssetsPrivate: false, rowVersion: 1 })).status,
      409,
    );
    assert.equal(
      (await patch(privateAuth, { marksAssetsPrivate: false, rowVersion: 2 })).status,
      200,
    );
    assert.equal(
      (await fetch(`${base}/api/photos/assets/${f.a.id}`, { headers: auth })).status,
      200,
    );
  } finally {
    await app.close();
  }
});

async function replacePrivacyFixture(f, assetId, uploadDb = prisma) {
  const { EagleUploadService } = await import('../../apps/api/dist/eagle/eagle-upload.service.js');
  const { PhotoRevisionObserver } =
    await import('../../apps/api/dist/photos/photo-revision.observer.js');
  const session = await prisma.uploadSession.create({
    data: {
      uploaderId: f.ownerId,
      libraryMode: 'PHOTO',
      status: 'ASSEMBLED',
      originalName: 'replacement.jpg',
      mimeType: 'image/jpeg',
      size: 1,
      objectKey: `test/${randomUUID()}`,
      multipartUploadId: 'isolated-test',
      completionParts: [{ PartNumber: 1, ETag: 'part' }],
      eagleState: { create: { duplicatePolicy: 'CREATE_COPY', replacementAssetId: assetId } },
    },
  });
  const upload = new EagleUploadService(
    uploadDb,
    { headObject: async () => ({ ContentLength: 1 }) },
    {},
    {
      inspect: async () => ({
        sha256: 'a'.repeat(64),
        format: 'jpg',
        width: 10,
        height: 10,
        durationMs: null,
      }),
    },
    'PHOTO',
    new PhotoRevisionObserver(),
  );
  return upload.complete(f.ownerId, session.id, { parts: [{ partNumber: 1, etag: 'part' }] });
}
for (const replacedRole of ['STILL', 'MOTION']) {
  test(`替换 ${replacedRole} 后，对端实况组件在全量重算后仍受保护`, async () => {
    const f = await fixture(),
      identifier = randomUUID();
    await prisma.eagleAsset.update({
      where: { id: f.a.id },
      data: { livePhotoIdentifier: identifier, livePhotoRole: 'STILL' },
    });
    const motion = await f.add({
      livePhotoIdentifier: identifier,
      livePhotoRole: 'MOTION',
      mimeType: 'video/quicktime',
    });
    if (replacedRole === 'STILL') await f.rule(true);
    else {
      const tagId = await prisma.$transaction((tx) => inheritedPrivacyTag(tx, f.ownerId, 'PHOTO'));
      await prisma.eagleAssetManualTag.create({
        data: { ownerId: f.ownerId, libraryMode: 'PHOTO', assetId: motion.id, tagId },
      });
      await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, undefined, 'PHOTO'));
    }
    await replacePrivacyFixture(f, replacedRole === 'STILL' ? f.a.id : motion.id);
    await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, undefined, 'PHOTO'));
    for (const id of [f.a.id, motion.id])
      assert.equal(
        (await prisma.eagleAsset.findUniqueOrThrow({ where: { id } })).isPrivate,
        true,
        `component ${id} lost its privacy after ${replacedRole} replacement`,
      );
    assert.equal(
      (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.publicAsset.id } })).isPrivate,
      false,
    );
  });
}
test('过期标签设置草稿不能静默取消新创建的继承私密保护', async () => {
  const f = await fixture(),
    loaded = await f.tags.getSettings(f.ownerId);
  const tagId = await prisma.$transaction((tx) => inheritedPrivacyTag(tx, f.ownerId, 'PHOTO'));
  await prisma.eagleAssetManualTag.create({
    data: { ownerId: f.ownerId, libraryMode: 'PHOTO', assetId: f.b.id, tagId },
  });
  await prisma.$transaction((tx) => syncAssetPrivacy(tx, f.ownerId, undefined, 'PHOTO'));
  await assert.rejects(
    f.tags.updateSettings(f.ownerId, { tagIds: loaded.tagIds, expectedTagIds: loaded.tagIds }),
    /变化/,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.b.id } })).isPrivate,
    true,
  );
});

if (process.env.PHOTO_PRIVACY_BENCH === '1') {
  test('实况组件的全量人物隐私投影在默认事务预算内完成', async () => {
    const count = Number(process.env.PHOTO_PRIVACY_BENCH_ASSETS ?? 12000);
    assert.ok([12000, 50000, 100000].includes(count));
    const f = await fixture();
    const identifiers = Array.from({ length: count / 2 }, () => randomUUID());
    const privateIdentifier = randomUUID();
    await prisma.eagleAsset.update({
      where: { id: f.a.id },
      data: { livePhotoIdentifier: privateIdentifier, livePhotoRole: 'STILL' },
    });
    await prisma.eagleAsset.update({
      where: { id: f.b.id },
      data: {
        livePhotoIdentifier: privateIdentifier,
        livePhotoRole: 'MOTION',
        mimeType: 'video/quicktime',
        format: 'mov',
      },
    });
    await prisma.eagleAsset.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        originalName: 'scale.jpg',
        displayName: 'scale',
        normalizedDisplayName: 'scale',
        mimeType: i % 2 ? 'video/quicktime' : 'image/jpeg',
        format: i % 2 ? 'mov' : 'jpg',
        byteSize: 1,
        originalObjectKey: `test/${randomUUID()}`,
        lifecycleStatus: 'READY',
        livePhotoIdentifier: identifiers[Math.floor(i / 2)],
        livePhotoRole: i % 2 ? 'MOTION' : 'STILL',
      })),
    });
    const start = performance.now();
    await f.rule(true, false);
    log(
      `Photo privacy projection, ${count + 3} assets: ${Math.round(performance.now() - start)}ms`,
    );
    assert.equal((await f.marked()).isPrivate, true);
    assert.equal(
      await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, isPrivate: true } }),
      2,
    );
  });
}

test('替换与取消人物私密并发时，继承标签和私密投影保持原子一致', async () => {
  const f = await fixture();
  await f.rule(true);
  const ready = Promise.withResolvers(),
    release = Promise.withResolvers();
  const uploadDb = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction')
        return (work) =>
          prisma.$transaction((tx) =>
            work(
              new Proxy(tx, {
                get(transaction, field) {
                  if (field === 'eagleAsset')
                    return new Proxy(tx.eagleAsset, {
                      get(delegate, operation) {
                        if (operation === 'findFirst')
                          return async (input) => {
                            const row = await delegate.findFirst(input);
                            if (input.where.id === f.a.id) {
                              ready.resolve();
                              await release.promise;
                            }
                            return row;
                          };
                        const value = Reflect.get(delegate, operation);
                        return typeof value === 'function' ? value.bind(delegate) : value;
                      },
                    });
                  const value = Reflect.get(transaction, field);
                  return typeof value === 'function' ? value.bind(transaction) : value;
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const replacing = replacePrivacyFixture(f, f.a.id, uploadDb);
  try {
    await Promise.race([
      ready.promise,
      delay(2000).then(() => {
        throw new Error('replacement barrier timed out');
      }),
    ]);
    const changing = f.rule(false);
    await delay(30);
    release.resolve();
    await Promise.all([replacing, changing]);
    assert.equal((await f.marked()).isPrivate, true);
    assert.equal(
      await prisma.eagleAssetManualTag.count({
        where: { ownerId: f.ownerId, assetId: f.a.id, tag: { marksAssetsPrivate: true } },
      }),
      1,
    );
  } finally {
    release.resolve();
    await replacing.catch(() => {});
  }
});

test('单张人物发布的隐私投影只读取目标及实况同伴，不随整库照片数量增长', async () => {
  const f = await fixture();
  const identifier = randomUUID();
  await prisma.eagleAsset.update({
    where: { id: f.a.id },
    data: { livePhotoIdentifier: identifier, livePhotoRole: 'STILL' },
  });
  await prisma.eagleAsset.update({
    where: { id: f.b.id },
    data: { livePhotoIdentifier: identifier, livePhotoRole: 'MOTION' },
  });
  const foreign = await fixture();
  await prisma.eagleAsset.update({
    where: { id: foreign.a.id },
    data: { livePhotoIdentifier: identifier, livePhotoRole: 'STILL' },
  });
  const material = await f.add({
    libraryMode: 'MATERIAL',
    livePhotoIdentifier: identifier,
    livePhotoRole: 'STILL',
  });
  await prisma.eaglePhotoPerson.update({
    where: { id: f.person.id },
    data: { marksAssetsPrivate: true },
  });
  const pairIdentifiers = Array.from({ length: 6000 }, () => randomUUID());
  await prisma.eagleAsset.createMany({
    data: Array.from({ length: 12000 }, (_, i) => ({
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      originalName: 'scale.jpg',
      displayName: 'scale',
      normalizedDisplayName: 'scale',
      mimeType: 'image/jpeg',
      format: 'jpg',
      byteSize: 1,
      originalObjectKey: 'test/' + randomUUID(),
      lifecycleStatus: 'READY',
      livePhotoIdentifier: pairIdentifiers[Math.floor(i / 2)],
      livePhotoRole: i % 2 ? 'MOTION' : 'STILL',
    })),
  });
  await prisma.$executeRawUnsafe('ANALYZE "EagleAsset"');
  let plan;
  await prisma.$transaction(async (tx) => {
    const wrapped = new Proxy(tx, {
      get(target, key) {
        if (key === '$executeRaw')
          return async (query) => {
            const result = await tx.$queryRawUnsafe(
              'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.text,
              ...query.values,
            );
            plan = result[0]['QUERY PLAN'][0].Plan;
            return 2;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await syncAssetPrivacy(wrapped, f.ownerId, [f.a.id], 'PHOTO');
  });
  const visits = (node) =>
    (node['Relation Name'] === 'EagleAsset'
      ? (node['Actual Rows'] +
          (node['Rows Removed by Filter'] ?? 0) +
          (node['Rows Removed by Index Recheck'] ?? 0)) *
        node['Actual Loops']
      : 0) + (node.Plans ?? []).reduce((sum, child) => sum + visits(child), 0);
  assert.ok(
    visits(plan) < 1000,
    'single-asset privacy publication scanned ' + visits(plan) + ' asset rows',
  );
  assert.equal((await f.marked()).isPrivate, true);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: foreign.a.id } })).isPrivate,
    false,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.b.id } })).isPrivate,
    true,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: material.id } })).isPrivate,
    false,
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.publicAsset.id } })).isPrivate,
    false,
  );
  await prisma.$transaction(async (tx) => {
    const wrapped = new Proxy(tx, {
      get(target, key) {
        if (key === '$executeRaw')
          return async (query) => {
            const result = await tx.$queryRawUnsafe(
              'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.text,
              ...query.values,
            );
            plan = result[0]['QUERY PLAN'][0].Plan;
            return 0;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await syncAssetPrivacy(wrapped, f.ownerId, [f.publicAsset.id], 'PHOTO');
  });
  assert.ok(
    visits(plan) < 1000,
    'null-identifier publication scanned ' + visits(plan) + ' asset rows',
  );
});

test('合并提交仍逐项保护租约、识别身份和人物私密，旧租约不污染同批结果', async () => {
  const f = await fixture();
  await f.rule(true);
  const assets = await Promise.all(Array.from({ length: 8 }, () => f.add()));
  const jobs = await Promise.all(
    assets.map((asset) =>
      prisma.eagleAssetProcessingJob.create({
        data: {
          ownerId: f.ownerId,
          libraryMode: 'PHOTO',
          assetId: asset.id,
          assetRevision: asset.mediaRevision,
          kind: 'ANALYZE_PHOTO_FACES',
          processorVersion: FACE_MODEL_VERSION,
          status: 'PROCESSING',
        },
      }),
    ),
  );
  const replacement = await prisma.eagleAssetProcessingJob.update({
    where: { id: jobs[0].id },
    data: { leaseVersion: { increment: 1 } },
  });
  let transactions = 0;
  const db = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction')
        return (work) => {
          transactions++;
          return prisma.$transaction(work);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const detections = [{ box: [0.1, 0.1, 0.4, 0.4], confidence: 1, embedding }];
  await Promise.all(jobs.map((job) => persistPhotoFaces(db, job, detections)));
  assert.equal(transactions, 1);
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: replacement.id } }))
      .status,
    'PROCESSING',
  );
  assert.equal(await prisma.eaglePhotoFace.count({ where: { assetId: assets[0].id } }), 0);
  for (const asset of assets.slice(1)) {
    const face = await prisma.eaglePhotoFace.findFirstOrThrow({ where: { assetId: asset.id } });
    assert.equal(face.personId, f.person.id);
    assert.equal(
      (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } })).isPrivate,
      true,
    );
  }
  assert.equal(
    await prisma.eagleAssetProcessingJob.count({
      where: { id: { in: jobs.slice(1).map((job) => job.id) }, status: 'COMPLETED' },
    }),
    7,
  );
  await persistPhotoFaces(db, replacement, detections);
  assert.equal(transactions, 2);
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: replacement.id } }))
      .status,
    'COMPLETED',
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: assets[0].id } })).isPrivate,
    true,
  );
});

test('一张照片提交异常仅回滚该项，其他同批人脸仍按原事务独立发布', async () => {
  const f = await fixture();
  const assets = await Promise.all(Array.from({ length: 3 }, () => f.add()));
  const jobs = await Promise.all(
    assets.map((asset) =>
      prisma.eagleAssetProcessingJob.create({
        data: {
          ownerId: f.ownerId,
          libraryMode: 'PHOTO',
          assetId: asset.id,
          assetRevision: asset.mediaRevision,
          kind: 'ANALYZE_PHOTO_FACES',
          processorVersion: FACE_MODEL_VERSION,
          status: 'PROCESSING',
        },
      }),
    ),
  );
  const db = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction')
        return (work) =>
          prisma.$transaction((tx) =>
            work(
              new Proxy(tx, {
                get(transaction, field) {
                  if (field === 'eaglePhotoFace')
                    return new Proxy(tx.eaglePhotoFace, {
                      get(delegate, operation) {
                        if (operation === 'create')
                          return (input) => {
                            if (input.data.assetId === assets[1].id)
                              throw Error('isolated publication failure');
                            return delegate.create(input);
                          };
                        const value = Reflect.get(delegate, operation);
                        return typeof value === 'function' ? value.bind(delegate) : value;
                      },
                    });
                  const value = Reflect.get(transaction, field);
                  return typeof value === 'function' ? value.bind(transaction) : value;
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const outcomes = await Promise.allSettled(
    jobs.map((job) =>
      persistPhotoFaces(db, job, [{ box: [0.1, 0.1, 0.4, 0.4], confidence: 1, embedding }]),
    ),
  );
  assert.deepEqual(
    outcomes.map((value) => value.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
  for (const index of [0, 2]) {
    assert.equal(
      (await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: jobs[index].id } }))
        .status,
      'COMPLETED',
    );
    assert.equal(await prisma.eaglePhotoFace.count({ where: { assetId: assets[index].id } }), 1);
  }
  assert.equal(
    (await prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: jobs[1].id } })).status,
    'PROCESSING',
  );
  assert.equal(await prisma.eaglePhotoFace.count({ where: { assetId: assets[1].id } }), 0);
});
