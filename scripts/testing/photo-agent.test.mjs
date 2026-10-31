import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { PhotoAgentService } from '../../apps/api/dist/photos/photo-agent.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());
// Persist the pre-handoff journal shape to exercise in-flight historical copy plans.
const legacyTransferDb = prisma.$extends({
  query: {
    eagleLibraryTransfer: {
      create({ args, query }) {
        if (Array.isArray(args.data.plan))
          args.data.plan = args.data.plan.map((item) => {
            const legacy = { ...item };
            delete legacy.storageAction;
            const root = `users/${args.data.ownerId}/assets/${item.targetId}`;
            return {
              ...legacy,
              targetKey: `${root}/original.jpg`,
              renditions: (item.renditions ?? []).map((r) => ({
                ...r,
                targetKey: `${root}/transfer/${r.id}`,
              })),
              ...(item.pyramid
                ? {
                    pyramid: {
                      ...item.pyramid,
                      targetPrefix: `${root}/pyramids/1/transfer-${item.pyramid.id}/`,
                    },
                  }
                : {}),
            };
          });
        return query(args);
      },
    },
  },
});

const city = {
  id: 'cn-zj-hangzhou',
  name: '杭州市',
  country: '中国',
  region: '浙江省',
  latitude: 30.25,
  longitude: 120.15,
};
async function fixture() {
  const ownerId = randomUUID();
  await prisma.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'test-only' },
  });
  const add = (libraryMode = 'PHOTO', more = {}) =>
    prisma.eagleAsset.create({
      data: {
        ownerId,
        libraryMode,
        originalName: 'Screenshot_2026.png',
        displayName: 'sample',
        normalizedDisplayName: 'sample',
        mimeType: 'image/png',
        format: 'png',
        byteSize: 1,
        originalObjectKey: `test/${randomUUID()}`,
        lifecycleStatus: 'READY',
        ...more,
      },
    });
  const a = await add(),
    b = await add(),
    c = await add();
  for (const [asset, minute, gps] of [
    [a, 0, false],
    [b, -5, true],
    [c, 5, true],
  ])
    await prisma.eaglePhotoMetadata.create({
      data: {
        ownerId,
        assetId: asset.id,
        assetRevision: 0,
        processorVersion: 'test',
        capturedAt: new Date(Date.parse('2026-10-01T10:00:00Z') + minute * 60000),
        captureTimeZoneKnown: true,
        ...(gps ? { latitude: 30.25, longitude: 120.15 } : {}),
      },
    });
  const service = new PhotoAgentService(prisma, {
    prepare: async () => ({ status: 'UNAVAILABLE', spaceId: 'test' }),
  });
  const photos = new EagleService(prisma, undefined, 'PHOTO');
  const task = async (kind = 'CITY') =>
    service.createTask(ownerId, { kind, assetIds: [a.id, b.id, c.id] }, false);
  const proposal = async (t, more = {}) =>
    service.propose(
      ownerId,
      t.id,
      {
        assetId: a.id,
        evidenceIds: t.kind === 'CITY' ? [b.id, c.id] : [],
        visualReviewed: true,
        rationale: '已核对画面与本次拍摄证据。',
        ...(t.kind === 'CITY' ? { city } : {}),
        ...more,
      },
      false,
    );
  return { ownerId, add, a, b, c, service, photos, task, proposal };
}
test('photo tasks freeze only visible owned PHOTO resources and paginate without leaking', async () => {
  const f = await fixture(),
    other = await fixture();
  const material = await f.add('MATERIAL'),
    hidden = await f.add('PHOTO', { isPrivate: true });
  for (const asset of [material, hidden, other.a])
    await assert.rejects(
      f.service.createTask(f.ownerId, { kind: 'CITY', assetIds: [f.a.id, asset.id] }, false),
      /不存在/,
    );
  const task = await f.task();
  await assert.rejects(f.service.detail(other.ownerId, task.id, false), /不存在/);
  const page = await f.service.photos(f.ownerId, { limit: 2 }, false);
  assert.equal(page.items.length, 2);
  assert.ok(page.next);
  assert.ok(page.items.every((a) => ![hidden.id, material.id].includes(a.id)));
  const next = await f.service.photos(f.ownerId, { limit: 2, after: page.next }, false);
  assert.ok(next.items.every((a) => !page.items.some((x) => x.id === a.id)));
  await prisma.eagleAsset.update({ where: { id: f.b.id }, data: { isPrivate: true } });
  await assert.rejects(f.service.detail(f.ownerId, task.id, false), /不存在/);
  assert.equal((await f.service.tasks(f.ownerId, { limit: 20 }, false)).items.length, 0);
});
test('fifty photo tasks use three list queries and still disappear when a frozen photo becomes private', async (t) => {
  const f = await fixture();
  const tasks = [];
  for (let index = 0; index < 50; index++) tasks.push(await f.task());
  await f.proposal(tasks[0]);
  const measured = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  let queries = 0;
  measured.$on('query', () => queries++);
  try {
    const service = new PhotoAgentService(measured, {});
    const result = await service.tasks(f.ownerId, { limit: 50 }, false);
    assert.equal(result.items.length, 50);
    assert.equal(result.items.find((row) => row.id === tasks[0].id).pendingCount, 1);
    assert.equal(queries, 3);
    t.diagnostic('50-task list: 3 SQL queries; original path: 101 queries.');
    await prisma.eagleAsset.update({ where: { id: f.b.id }, data: { isPrivate: true } });
    const hidden = await service.tasks(f.ownerId, { limit: 50 }, false);
    assert.equal(hidden.items.length, 0);
  } finally {
    await measured.$disconnect();
  }
});
test('city proposal, confirmation, shared asset projection, city filtering and undo preserve original GPS', async () => {
  const f = await fixture(),
    t = await f.task();
  const candidates = await f.service.infer(
    f.ownerId,
    t.id,
    { cities: [city], offsetSeconds: 0 },
    false,
  );
  assert.equal(candidates.candidates.length, 1);
  const p = await f.proposal(t);
  assert.equal((await f.proposal(t)).id, p.id, 'proposal retry is idempotent');
  await f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false);
  await f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false);
  const location = await prisma.eaglePhotoLocation.findUniqueOrThrow({
    where: { assetId: f.a.id },
  });
  assert.equal(location.cityId, city.id);
  assert.equal(location.source, 'INFERRED');
  assert.equal(
    (await prisma.eaglePhotoMetadata.findUniqueOrThrow({ where: { assetId: f.a.id } })).latitude,
    null,
  );
  const asset = await f.photos.getAsset(f.ownerId, f.a.id);
  assert.equal(asset.photoLocation.name, city.name);
  const result = await f.photos.listAssets(f.ownerId, {
    limit: 20,
    rules: JSON.stringify({
      version: 2,
      conditions: [
        {
          id: 'city',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'r', field: 'CITY', operator: 'EQUALS', value: city.name }],
        },
      ],
    }),
  });
  assert.deepEqual(
    result.items.map((a) => a.id),
    [f.a.id],
  );
  await f.service.undo(f.ownerId, t.id, p.id, false);
  await f.service.undo(f.ownerId, t.id, p.id, false);
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 0);
});
test('non-photo human decisions, trash, undo and cancellation are durable and idempotent', async () => {
  const f = await fixture(),
    t = await f.task('NON_PHOTO');
  const p = await f.proposal(t);
  await f.service.review(f.ownerId, t.id, p.id, { action: 'REJECT' }, false);
  const again = await f.task('NON_PHOTO');
  await assert.rejects(f.proposal(again), /人工保留/);
  const g = await fixture(),
    gt = await g.task('NON_PHOTO'),
    gp = await g.proposal(gt);
  await g.service.review(g.ownerId, gt.id, gp.id, { action: 'ACCEPT' }, false);
  const after = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: g.a.id } });
  assert.ok(after.deletedAt);
  assert.equal(after.rowVersion, 2);
  await g.service.review(g.ownerId, gt.id, gp.id, { action: 'ACCEPT' }, false);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: g.a.id } })).rowVersion,
    2,
  );
  await g.service.cancel(g.ownerId, gt.id, false);
  await g.service.undo(g.ownerId, gt.id, gp.id, false);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: g.a.id } })).deletedAt,
    null,
  );
});
test('stale target, evidence, expired plan, cancellation and revoked visibility cannot apply', async () => {
  for (const variant of ['target', 'evidence', 'expired', 'cancelled', 'private']) {
    const f = await fixture(),
      t = await f.task(),
      p = await f.proposal(t);
    if (variant === 'target' || variant === 'evidence')
      await prisma.eagleAsset.update({
        where: { id: variant === 'target' ? f.a.id : f.b.id },
        data: { rowVersion: { increment: 1 } },
      });
    if (variant === 'expired')
      await prisma.eaglePhotoAgentTask.update({
        where: { id: t.id },
        data: { expiresAt: new Date(0) },
      });
    if (variant === 'cancelled') await f.service.cancel(f.ownerId, t.id, false);
    if (variant === 'private')
      await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { isPrivate: true } });
    await assert.rejects(f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false));
    assert.equal(
      await prisma.eaglePhotoLocation.count({ where: { ownerId: f.ownerId } }),
      0,
      variant,
    );
  }
});
test('undo cannot overwrite later edits, and replacement invalidates accepted location', async () => {
  const f = await fixture(),
    t = await f.task(),
    p = await f.proposal(t);
  await f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false);
  await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { rowVersion: { increment: 1 } } });
  await assert.rejects(f.service.undo(f.ownerId, t.id, p.id, false), /已变化/);
  await prisma.eagleAsset.update({
    where: { id: f.a.id },
    data: { mediaRevision: { increment: 1 } },
  });
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 0);
});
test('model unavailable reports filename-only candidates and never creates verdicts', async () => {
  const f = await fixture(),
    t = await f.task('NON_PHOTO');
  const result = await f.service.scores(f.ownerId, t.id, 'screenshot', false);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.ok(result.items.every((a) => a.filenameSignals.includes('SCREENSHOT_NAME')));
  assert.equal((await f.service.detail(f.ownerId, t.id, false)).suggestions.length, 0);
  await assert.rejects(f.proposal(t, { visualReviewed: false }), /查看照片/);
});
test('database scope constraints reject cross-owner, mode and invalid city coordinates', async () => {
  const f = await fixture(),
    other = await fixture(),
    t = await f.task();
  await assert.rejects(
    prisma.eaglePhotoAgentTask.update({ where: { id: t.id }, data: { libraryMode: 'MATERIAL' } }),
  );
  await assert.rejects(
    prisma.eaglePhotoAgentSuggestion.create({
      data: {
        ownerId: other.ownerId,
        taskId: t.id,
        assetId: other.a.id,
        assetRevision: 0,
        assetRowVersion: 1,
        kind: 'CITY',
        value: {},
        evidence: [],
        rationale: 'invalid scope',
      },
    }),
  );
  await assert.rejects(
    prisma.eaglePhotoLocation.create({
      data: {
        ownerId: f.ownerId,
        assetId: f.a.id,
        assetRevision: 0,
        cityId: 'invalid',
        name: 'invalid',
        country: 'x',
        region: 'x',
        latitude: 91,
        longitude: 0,
        suggestionId: randomUUID(),
      },
    }),
  );
});
test('real HTTP rejects PAT review and cross-scope requests but permits photo-scoped reads and proposals', async () => {
  const defaults = {
    NODE_ENV: 'test',
    PORT: '3000',
    CANONICAL_ORIGIN: 'http://localhost:8180',
    JWT_ACCESS_SECRET: 'isolated-photo-agent-signing-key-over-32-characters',
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
  const { ACCESS_COOKIE_NAME } = await import('../../apps/api/dist/auth/auth.constants.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  const { installPhotoRequestBodyParser } =
    await import('../../apps/api/dist/photos/photo-request-body.js');
  installPhotoRequestBodyParser(app);
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(),
      f = await fixture(),
      t = await f.task(),
      p = await f.proposal(t);
    const pat = await app
      .get(PatService)
      .create(f.ownerId, 'test-photo-agent', ['photo:read', 'photo:suggest']);
    const read = await app.get(PatService).create(f.ownerId, 'test-read', ['photo:read']);
    const auth = { authorization: `Bearer ${pat.token}`, 'content-type': 'application/json' };
    assert.equal(
      (await fetch(`${base}/api/photos/agent/instructions`, { headers: auth })).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/api/photos/agent/instructions`, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({
            instructions: 'Agent must not overwrite owner rules',
            revision: 0,
          }),
        })
      ).status,
      403,
    );

    assert.equal((await fetch(`${base}/api/photos/agent/photos`)).status, 401);
    assert.equal((await fetch(`${base}/api/photos/agent/photos`, { headers: auth })).status, 200);
    // Malformed compressed bodies must fail through the parser callback, without terminating HTTP.
    for (const path of ['requests', 'tasks']) {
      const malformed = await fetch(`${base}/api/photos/agent/${path}`, {
        method: 'POST',
        headers: { ...auth, 'content-encoding': 'gzip' },
        body: Buffer.concat([
          gzipSync(Buffer.from('{}')),
          Buffer.from('unexpected trailing bytes'),
        ]),
      });
      assert.equal(malformed.status, 400);
      assert.equal((await fetch(`${base}/api/photos/agent/photos`, { headers: auth })).status, 200);
    }

    assert.equal(
      (await fetch(`${base}/api/photos/agent/photos?ownerId=x`, { headers: auth })).status,
      400,
    );
    for (const path of [
      `tasks/${t.id}/manual-action`,
      `tasks/${t.id}/cancel`,
      `tasks/${t.id}/review`,
      `tasks/${t.id}/suggestions/${p.id}/review`,
      `tasks/${t.id}/suggestions/${p.id}/undo`,
    ])
      assert.equal(
        (
          await fetch(`${base}/api/photos/agent/${path}`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ action: 'ACCEPT' }),
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await fetch(`${base}/api/photos/agent/tasks`, {
          method: 'POST',
          headers: { ...auth, authorization: `Bearer ${read.token}` },
          body: JSON.stringify({ kind: 'CITY', assetIds: [f.a.id] }),
        })
      ).status,
      403,
    );
    const batchIds = Array.from({ length: 200 }, () => randomUUID());
    await prisma.eagleAsset.createMany({
      data: batchIds.map((id) => ({
        id,
        ownerId: f.ownerId,
        libraryMode: 'PHOTO',
        originalName: 'synthetic.jpg',
        displayName: 'Batch sample',
        normalizedDisplayName: 'batch sample',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        originalObjectKey: `test/${id}`,
        lifecycleStatus: 'READY',
      })),
    });
    const batchBody = {
      kind: 'DELETE',
      title: 'Large application',
      rationale: 'Only a proposal for human review.',
      items: batchIds.map((assetId) => ({
        assetId,
        evidenceIds: [],
        visualReviewed: true,
        rationale: 'Synthetic reason. '.repeat(80),
      })),
    };
    const submission = await fetch(`${base}/api/photos/agent/requests`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(batchBody),
    });
    assert.equal(submission.status, 201);
    const submitted = await submission.json();
    assert.equal(submitted.count, 200);
    assert.equal(
      await prisma.eagleAsset.count({ where: { id: { in: batchIds }, deletedAt: null } }),
      200,
    );
    const denied = await fetch(`${base}/api/photos/agent/requests`, {
      method: 'POST',
      headers: { ...auth, authorization: `Bearer ${read.token}` },
      body: JSON.stringify({ ...batchBody, items: [batchBody.items[0]] }),
    });
    assert.equal(denied.status, 403);
    const oversized = await fetch(`${base}/api/photos/agent/requests`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ ...batchBody, rationale: 'x'.repeat(3 * 1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.ownerId } }),
      session = await app.get(SessionTokenService).createSession(user);
    const response = await fetch(
      `${base}/api/photos/agent/tasks/${t.id}/suggestions/${p.id}/review`,
      {
        method: 'POST',
        headers: {
          cookie: `${ACCESS_COOKIE_NAME}=${session.accessToken}`,
          'content-type': 'application/json',
          origin: 'http://localhost:8180',
        },
        body: JSON.stringify({ action: 'ACCEPT' }),
      },
    );
    assert.equal(response.status, 201, await response.text());
    const current = await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } });
    const manualBody = {
      operationId: randomUUID(),
      action: 'DELETE',
      items: [
        {
          suggestionId: p.id,
          mediaRevision: current.mediaRevision,
          rowVersion: current.rowVersion,
        },
      ],
    };
    for (const [origin, status] of [
      ['http://untrusted.invalid', 403],
      ['http://localhost:8180', 201],
    ]) {
      const manual = await fetch(`${base}/api/photos/agent/tasks/${t.id}/manual-action`, {
        method: 'POST',
        headers: {
          cookie: `${ACCESS_COOKIE_NAME}=${session.accessToken}`,
          'content-type': 'application/json',
          origin,
        },
        body: JSON.stringify(manualBody),
      });
      assert.equal(manual.status, status, await manual.text());
    }
    assert.ok((await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt);
  } finally {
    await app.close();
  }
});

test('re-extracted GPS evidence invalidates a pending city proposal even without a media revision change', async () => {
  const f = await fixture(),
    t = await f.task(),
    p = await f.proposal(t);
  await prisma.eaglePhotoMetadata.update({
    where: { assetId: f.b.id },
    data: { longitude: 100, analyzedAt: new Date(Date.now() + 1000) },
  });
  await assert.rejects(
    f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false),
    /证据|变化/,
  );
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 0);
});
test('clock corrections require an explicit camera scope and accepted replay remains safe after expiry', async () => {
  const f = await fixture(),
    t = await f.task();
  await assert.rejects(
    f.service.infer(f.ownerId, t.id, { cities: [city], offsetSeconds: 420 }, false),
    /相机/,
  );
  const p = await f.proposal(t);
  await f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false);
  await prisma.eaglePhotoAgentTask.update({
    where: { id: t.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (await f.service.review(f.ownerId, t.id, p.id, { action: 'ACCEPT' }, false)).status,
    'ACCEPTED',
  );
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 1);
});

test('bounded 2B scoring excludes stale embeddings and scopes candidates to the task', async () => {
  const { Prisma } = await import('@prisma/client');
  const f = await fixture(),
    other = await fixture(),
    task = await f.task('NON_PHOTO');
  const spaceId = `agent-test-${randomUUID()}`;
  await prisma.eagleEmbeddingSpace.create({
    data: {
      id: spaceId,
      model: 'test',
      revision: spaceId,
      dimensions: 1024,
      instructionVersion: 'image-retrieval-v1',
      preprocessingVersion: 'preview-webp-v1',
      normalized: true,
      isCurrent: false,
    },
  });
  const vector = `[${[1, ...Array(1023).fill(0)].join(',')}]`;
  for (const [asset, revision] of [
    [f.a, 0],
    [f.b, 99],
    [other.a, 0],
  ])
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent",embedding,"updatedAt") VALUES (${randomUUID()},${asset.ownerId},'PHOTO',${asset.id},${revision},${spaceId},'READY',true,${vector}::vector,now())`,
    );
  const agent = new PhotoAgentService(prisma, {
    prepare: async () => ({ status: 'READY', spaceId, vector }),
  });
  const result = await agent.scores(f.ownerId, task.id, 'screenshot', false);
  assert.equal(result.status, 'READY');
  assert.deepEqual(
    result.items.map((i) => i.assetId),
    [f.a.id],
  );
  assert.equal(result.items[0].similarity, 1);
  assert.ok(result.unanalysed.includes(f.b.id));
});
test('preview returns current derived media only and manual city corrections retain source', async () => {
  const f = await fixture(),
    task = await f.task();
  await assert.rejects(f.service.preview(f.ownerId, f.a.id, false), /不存在/);
  const rendition = await prisma.eagleAssetRendition.create({
    data: {
      assetId: f.a.id,
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      kind: 'THUMBNAIL',
      revision: 0,
      status: 'READY',
      mimeType: 'image/webp',
      storageKey: `test/${randomUUID()}`,
      byteSize: 10,
      width: 256,
      height: 256,
    },
  });
  assert.equal(await f.service.preview(f.ownerId, f.a.id, false), rendition.id);
  const p = await f.proposal(task);
  await f.service.review(
    f.ownerId,
    task.id,
    p.id,
    { action: 'ACCEPT', city: { ...city, name: '人工确认的城市' } },
    false,
  );
  assert.equal(
    (await prisma.eaglePhotoLocation.findUniqueOrThrow({ where: { assetId: f.a.id } })).source,
    'MANUAL',
  );
});

test('proposal validation rejects missing GPS proof, wrong task kinds, protected media and unknown IDs', async () => {
  const f = await fixture(),
    t = await f.task();
  await assert.rejects(f.proposal(t, { city: undefined }), /城市/);
  await assert.rejects(f.proposal(t, { evidenceIds: [] }), /参考照片/);
  await assert.rejects(f.proposal(t, { evidenceIds: [randomUUID()] }), /不存在/);
  await assert.rejects(f.proposal(t, { assetId: randomUUID() }), /不存在/);
  await assert.rejects(f.proposal(t, { evidenceIds: [f.a.id] }), /GPS/);
  await assert.rejects(f.proposal(t, { assetId: f.b.id }), /已有位置/);
  const non = await f.task('NON_PHOTO');
  await assert.rejects(
    f.service.infer(f.ownerId, non.id, { cities: [city], offsetSeconds: 0 }, false),
    /不是城市/,
  );
  await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { originalName: 'photo.NEF' } });
  await assert.rejects(f.proposal(non), /不支持/);
  await assert.rejects(f.service.undo(f.ownerId, t.id, randomUUID(), false), /不存在/);
  const g = await fixture(),
    gt = await g.task(),
    gp = await g.proposal(gt);
  await assert.rejects(g.service.undo(g.ownerId, gt.id, gp.id, false), /已应用/);
  await assert.rejects(
    g.service.review(g.ownerId, gt.id, randomUUID(), { action: 'REJECT' }, false),
    /不存在/,
  );
  const page = await g.service.tasks(g.ownerId, { limit: 1 }, false);
  assert.equal(page.items.length, 1);
  const start = new Date('2026-01-01T00:00:00Z').toISOString(),
    end = new Date('2027-01-01T00:00:00Z').toISOString();
  assert.equal(
    (await g.service.photos(g.ownerId, { limit: 10, from: start, to: end }, true)).items.length,
    3,
  );
  await assert.rejects(
    g.service.photos(g.ownerId, { limit: 10, from: end, to: start }, false),
    /范围/,
  );
});

test('grouped requests stay proposals until human review and preserve exact-location precision', async () => {
  const f = await fixture();
  const second = await f.add();
  const input = {
    kind: 'CITY',
    title: 'Grouped location request',
    rationale: 'Agent supplied the grouping and location reasoning.',
    items: [f.a, second].map((asset) => ({
      assetId: asset.id,
      city: { ...city, precision: 'EXACT', accuracyMeters: 25 },
      evidenceIds: [],
      visualReviewed: true,
      rationale: 'Agent reviewed this image and supplied a location.',
    })),
  };
  const before = await prisma.eaglePhotoAgentTask.count({ where: { ownerId: f.ownerId } });
  await assert.rejects(
    f.service.submitRequest(
      f.ownerId,
      { ...input, items: [...input.items, { ...input.items[0], assetId: randomUUID() }] },
      false,
    ),
    /不存在/,
  );
  assert.equal(await prisma.eaglePhotoAgentTask.count({ where: { ownerId: f.ownerId } }), before);
  const request = await f.service.submitRequest(f.ownerId, input, false);
  const detail = await f.service.detail(f.ownerId, request.id, false);
  assert.equal(detail.expiresAt, null);
  assert.equal(detail.title, input.title);
  assert.equal(detail.suggestions.length, 2);
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { ownerId: f.ownerId } }), 0);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt,
    null,
  );
  const one = detail.suggestions.find((item) => item.assetId === f.a.id);
  const two = detail.suggestions.find((item) => item.assetId === second.id);
  await assert.rejects(
    f.service.reviewBatch(
      randomUUID(),
      request.id,
      { suggestionIds: [one.id], action: 'ACCEPT' },
      false,
    ),
    /不存在/,
  );
  await assert.rejects(
    f.service.reviewBatch(
      f.ownerId,
      request.id,
      { suggestionIds: [one.id, randomUUID()], action: 'ACCEPT' },
      false,
    ),
    /不存在/,
  );
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { ownerId: f.ownerId } }), 0);
  const approved = await f.service.reviewBatch(
    f.ownerId,
    request.id,
    { suggestionIds: [one.id], action: 'ACCEPT' },
    false,
  );
  assert.equal(approved.succeeded, 1);
  const location = await prisma.eaglePhotoLocation.findUniqueOrThrow({
    where: { assetId: f.a.id },
  });
  assert.equal(location.precision, 'EXACT');
  assert.equal(location.accuracyMeters, 25);
  assert.equal(
    (await prisma.eaglePhotoMetadata.findUniqueOrThrow({ where: { assetId: f.a.id } })).latitude,
    null,
  );
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: second.id } }), 0);
  await prisma.eagleAsset.update({
    where: { id: second.id },
    data: { rowVersion: { increment: 1 } },
  });
  const stale = await f.service.reviewBatch(
    f.ownerId,
    request.id,
    { suggestionIds: [two.id], action: 'ACCEPT' },
    false,
  );
  assert.equal(stale.failed, 1);
  const rejected = await f.service.reviewBatch(
    f.ownerId,
    request.id,
    { suggestionIds: [two.id], action: 'REJECT' },
    false,
  );
  assert.equal(rejected.succeeded, 1);
  await f.service.undo(f.ownerId, request.id, one.id, false);
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 0);
});

test('send approval reuses the shared transfer, survives interruption and cannot duplicate targets', async () => {
  const { EagleLibraryTransferService } =
    await import('../../apps/api/dist/eagle/eagle-library-transfer.service.js');
  const f = await fixture();
  await prisma.eagleAsset.update({
    where: { id: f.a.id },
    data: { originalObjectKey: `users/${f.ownerId}/assets/${f.a.id}/original.png` },
  });
  let copies = 0,
    fail = true;
  const transfer = new EagleLibraryTransferService(
    legacyTransferDb,
    {
      copyObject: async () => {
        copies++;
        if (fail) throw new Error('synthetic copy interruption');
      },
      headObject: async () => ({ ContentLength: 1 }),
    },
    'PHOTO',
  );
  const service = new PhotoAgentService(prisma, {}, transfer);
  const request = await service.submitRequest(
    f.ownerId,
    {
      kind: 'SEND_TO_MATERIAL',
      title: 'Transfer request',
      rationale: 'Agent proposes moving this reference image to Materials.',
      items: [
        {
          assetId: f.a.id,
          evidenceIds: [],
          visualReviewed: true,
          rationale: 'Agent reviewed the image and proposes a transfer.',
        },
      ],
    },
    false,
  );
  const suggestion = (await service.detail(f.ownerId, request.id, false)).suggestions[0];
  assert.equal(copies, 0);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    0,
  );
  assert.equal(
    (
      await service.reviewBatch(
        f.ownerId,
        request.id,
        { suggestionIds: [suggestion.id], action: 'ACCEPT' },
        false,
      )
    ).failed,
    1,
  );
  assert.equal(
    (await prisma.eaglePhotoAgentSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } }))
      .status,
    'FAILED',
  );
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt,
    null,
  );
  fail = false;
  const success = await service.reviewBatch(
    f.ownerId,
    request.id,
    { suggestionIds: [suggestion.id], action: 'ACCEPT' },
    false,
  );
  assert.equal(success.succeeded, 1);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    1,
  );
  assert.ok((await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt);
  const before = copies;
  await service.reviewBatch(
    f.ownerId,
    request.id,
    { suggestionIds: [suggestion.id], action: 'ACCEPT' },
    false,
  );
  assert.equal(copies, before);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId: f.ownerId, libraryMode: 'MATERIAL' } }),
    1,
  );
  await assert.rejects(service.undo(f.ownerId, request.id, suggestion.id, false), /素材模式/);
});

test('delete requests accept Agent-defined criteria but never trash until approval', async () => {
  const f = await fixture();
  const request = await f.service.submitRequest(
    f.ownerId,
    {
      kind: 'DELETE',
      title: 'Delete request',
      rationale: 'Agent has supplied its own reasons for this request.',
      items: [
        {
          assetId: f.a.id,
          evidenceIds: [],
          visualReviewed: true,
          rationale: 'Agent reviewed this photo; this is a synthetic test reason.',
        },
      ],
    },
    false,
  );
  const suggestion = (await f.service.detail(f.ownerId, request.id, false)).suggestions[0];
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt,
    null,
  );
  await assert.rejects(
    f.service.submitRequest(
      f.ownerId,
      {
        kind: 'DELETE',
        title: 'Duplicate',
        rationale: 'Another pending application.',
        items: [
          {
            assetId: f.a.id,
            evidenceIds: [],
            visualReviewed: true,
            rationale: 'Duplicate proposal for the same photo.',
          },
        ],
      },
      false,
    ),
    /待处理申请/,
  );
  await f.service.reviewBatch(
    f.ownerId,
    request.id,
    { suggestionIds: [suggestion.id], action: 'ACCEPT' },
    false,
  );
  assert.ok((await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt);
  await f.service.undo(f.ownerId, request.id, suggestion.id, false);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt,
    null,
  );
});

test('cancelled legacy drafts do not block a fresh grouped application', async () => {
  const f = await fixture();
  const draft = await f.task('NON_PHOTO');
  await f.proposal(draft);
  await f.service.cancel(f.ownerId, draft.id, false);
  const application = await f.service.submitRequest(
    f.ownerId,
    {
      kind: 'DELETE',
      title: 'New application',
      rationale: 'Agent has reconsidered this synthetic photo.',
      items: [
        {
          assetId: f.a.id,
          evidenceIds: [],
          visualReviewed: true,
          rationale: 'New explicit application after cancellation.',
        },
      ],
    },
    false,
  );
  assert.ok(application.id);
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt,
    null,
  );
});

test('approval history is append-only, owner/private scoped and retains original execution after undo', async () => {
  const f = await fixture(),
    other = await fixture();
  const task = await f.task();
  const suggestion = await f.proposal(task);
  let page = await f.service.history(f.ownerId, task.id, { limit: 1 }, false);
  assert.equal(page.items[0].action, 'PROPOSED');
  assert.equal(page.items[0].actor, 'AGENT');
  await assert.rejects(f.service.history(other.ownerId, task.id, { limit: 20 }, true), /不存在/);
  await assert.rejects(
    f.service.history(f.ownerId, task.id, { limit: 20, after: randomUUID() }, false),
    /不存在/,
  );
  await f.service.review(f.ownerId, task.id, suggestion.id, { action: 'ACCEPT' }, false);
  const count = await prisma.eaglePhotoAgentEvent.count({ where: { taskId: task.id } });
  await f.service.review(f.ownerId, task.id, suggestion.id, { action: 'ACCEPT' }, false);
  assert.equal(await prisma.eaglePhotoAgentEvent.count({ where: { taskId: task.id } }), count);
  await f.service.undo(f.ownerId, task.id, suggestion.id, false);
  page = await f.service.history(f.ownerId, task.id, { limit: 1 }, false);
  assert.equal(page.items[0].action, 'UNDONE');
  assert.equal(page.items[0].actor, 'HUMAN');
  assert.ok(page.items[0].details.originalOperation.assetRowVersion);
  const older = await f.service.history(f.ownerId, task.id, { limit: 20, after: page.next }, false);
  assert.deepEqual(new Set(older.items.map((e) => e.action)), new Set(['EXECUTED', 'PROPOSED']));
  const applied = older.items.find((e) => e.action === 'EXECUTED');
  assert.equal(applied.details.value.name, city.name);
  assert.equal(applied.details.before.rowVersion, f.a.rowVersion);
  await assert.rejects(
    prisma.eaglePhotoAgentEvent.update({ where: { id: applied.id }, data: { details: {} } }),
    /append-only/,
  );
  await assert.rejects(
    prisma.eaglePhotoAgentEvent.delete({ where: { id: applied.id } }),
    /append-only/,
  );
  await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { isPrivate: true } });
  await assert.rejects(f.service.history(f.ownerId, task.id, { limit: 20 }, false), /不存在/);
  assert.equal((await f.service.history(f.ownerId, task.id, { limit: 20 }, true)).items.length, 3);
  // A permanent resource purge must not cascade away the historical action snapshots.
  await prisma.eagleAsset.delete({ where: { id: f.a.id } });
  assert.equal(await prisma.eaglePhotoAgentEvent.count({ where: { taskId: task.id } }), 3);
});

test('later edits block undo and retain both successful execution and failed undo attempts', async () => {
  const f = await fixture();
  const task = await f.task();
  const suggestion = await f.proposal(task);
  await f.service.review(f.ownerId, task.id, suggestion.id, { action: 'ACCEPT' }, false);
  await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { rowVersion: { increment: 1 } } });
  await assert.rejects(f.service.undo(f.ownerId, task.id, suggestion.id, false), /无法安全撤销/);
  const history = await f.service.history(f.ownerId, task.id, { limit: 20 }, false);
  assert.equal(history.items[0].action, 'UNDO_FAILED');
  assert.ok(history.items.some((e) => e.action === 'EXECUTED'));
  assert.ok(!history.items.some((e) => e.action === 'UNDONE'));
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 1);
});

test('delete audit freezes all logical photo components and undo refuses later motion edits', async () => {
  const f = await fixture(),
    identifier = randomUUID();
  await prisma.eagleAsset.update({
    where: { id: f.a.id },
    data: { livePhotoIdentifier: identifier, livePhotoRole: 'STILL' },
  });
  const motion = await f.add('PHOTO', {
    livePhotoIdentifier: identifier,
    livePhotoRole: 'MOTION',
    mimeType: 'video/quicktime',
  });
  await prisma.eagleAssetRendition.create({
    data: {
      ownerId: f.ownerId,
      libraryMode: 'PHOTO',
      assetId: motion.id,
      kind: 'PREVIEW',
      status: 'READY',
      revision: motion.mediaRevision,
      storageKey: `test/${randomUUID()}`,
      mimeType: 'video/mp4',
      byteSize: 1,
    },
  });
  const request = await f.service.submitRequest(
    f.ownerId,
    {
      kind: 'DELETE',
      title: 'Logical photo request',
      rationale: 'Agent proposes removing this synthetic logical photo.',
      items: [
        {
          assetId: f.a.id,
          evidenceIds: [],
          visualReviewed: true,
          rationale: 'Synthetic approval test.',
        },
      ],
    },
    false,
  );
  const suggestion = (await f.service.detail(f.ownerId, request.id, false)).suggestions[0];
  await f.service.review(f.ownerId, request.id, suggestion.id, { action: 'ACCEPT' }, false);
  const history = await f.service.history(f.ownerId, request.id, { limit: 20 }, false);
  const executed = history.items.find((event) => event.action === 'EXECUTED');
  assert.deepEqual(
    new Set(executed.details.operation.after.map((asset) => asset.id)),
    new Set([f.a.id, motion.id]),
  );
  await prisma.eagleAsset.update({
    where: { id: motion.id },
    data: { rowVersion: { increment: 1 } },
  });
  await assert.rejects(
    f.service.undo(f.ownerId, request.id, suggestion.id, false),
    /关联媒体已变化/,
  );
  for (const id of [f.a.id, motion.id])
    assert.ok((await prisma.eagleAsset.findUniqueOrThrow({ where: { id } })).deletedAt);
});

test('organizing instructions are owner scoped, revision fenced, clearable and PHOTO only', async () => {
  const f = await fixture(),
    other = await fixture();
  assert.deepEqual(await f.service.instructions(f.ownerId), {
    instructions: '',
    revision: 0,
    updatedAt: null,
  });
  const first = await f.service.saveInstructions(f.ownerId, {
    instructions: '仅文字筛选，不读图；先提交申请。',
    revision: 0,
  });
  assert.equal(first.revision, 1);
  assert.equal((await f.service.instructions(other.ownerId)).instructions, '');
  await assert.rejects(
    f.service.saveInstructions(f.ownerId, { instructions: 'stale', revision: 0 }),
    /其他页面/,
  );
  await assert.rejects(
    f.service.saveInstructions(f.ownerId, { instructions: 'stale', revision: 7 }),
    /其他页面/,
  );
  assert.equal(
    (await f.service.saveInstructions(f.ownerId, { instructions: '', revision: 1 })).revision,
    2,
  );
  assert.equal((await f.service.instructions(f.ownerId)).instructions, '');
  await assert.rejects(
    prisma.eaglePhotoAgentPreference.update({
      where: { ownerId_libraryMode: { ownerId: f.ownerId, libraryMode: 'PHOTO' } },
      data: { libraryMode: 'MATERIAL' },
    }),
  );
});

test('new metadata-only requests persist their evidence basis without applying changes', async () => {
  const f = await fixture();
  const input = {
    kind: 'SEND_TO_MATERIAL',
    title: '仅文字筛选',
    rationale: '只依据Screenshot文件名，未看图片，等待人工确认。',
    items: [
      {
        assetId: f.a.id,
        evidenceIds: [],
        visualReviewed: false,
        rationale: '文件名含Screenshot，未查看图片。',
      },
    ],
  };
  const result = await f.service.submitRequest(f.ownerId, input, false);
  const task = await f.service.detail(f.ownerId, result.id, false);
  assert.equal(task.suggestions[0].reviewBasis, 'METADATA');
  assert.equal(task.suggestions[0].status, 'PENDING');
  assert.equal(
    (await prisma.eagleAsset.findUniqueOrThrow({ where: { id: f.a.id } })).deletedAt,
    null,
  );
  const history = await f.service.history(f.ownerId, result.id, { limit: 20 }, false);
  assert.equal(history.items[0].details.reviewBasis, 'METADATA');
  await assert.rejects(
    f.service.submitRequest(
      f.ownerId,
      { ...input, kind: 'CITY', items: [{ ...input.items[0], assetId: f.b.id, city }] },
      false,
    ),
    /查看照片/,
  );
  for (const bad of [await f.add('MATERIAL'), await f.add('PHOTO', { isPrivate: true })])
    await assert.rejects(
      f.service.submitRequest(
        f.ownerId,
        { ...input, items: [{ ...input.items[0], assetId: bad.id }] },
        false,
      ),
      /不存在/,
    );
});

test('request numbers stay owner-scoped and stable; photo item numbers follow submission order', async () => {
  const f = await fixture(),
    other = await fixture();
  const make = (assetId, title) => ({
    kind: 'DELETE',
    title,
    rationale: '仅按文字检查的明确测试理由',
    items: [
      { assetId, evidenceIds: [], visualReviewed: false, rationale: '测试文件名具有明确截图信号' },
    ],
  });
  const first = await f.service.submitRequest(f.ownerId, make(f.a.id, 'first'), false);
  const second = await f.service.submitRequest(f.ownerId, make(f.b.id, 'second'), false);
  const foreign = await other.service.submitRequest(
    other.ownerId,
    make(other.a.id, 'other'),
    false,
  );
  assert.equal(first.number, 1);
  assert.equal(second.number, 2);
  assert.equal(foreign.number, 1);
  const detail = await f.service.detailByNumber(f.ownerId, 1, false);
  assert.equal(detail.id, first.id);
  assert.equal(detail.number, 1);
  assert.equal(detail.suggestions[0].number, 1);
  await assert.rejects(other.service.detailByNumber(other.ownerId, 2, false), /不存在/);
  const list = await f.service.tasks(f.ownerId, { limit: 20 }, false);
  assert.deepEqual(
    list.items.map((x) => x.number),
    [2, 1],
  );
});

test('manual photo actions use current selected versions, preserve original advice and append separate human history', async () => {
  const f = await fixture();
  const t = await f.task('CITY');
  const suggestion = await f.proposal(t);
  const input = {
    operationId: randomUUID(),
    action: 'DELETE',
    items: [
      { suggestionId: suggestion.id, mediaRevision: f.a.mediaRevision, rowVersion: f.a.rowVersion },
    ],
  };
  await f.service.manualAction(f.ownerId, t.id, input, false);
  assert.ok((await prisma.eagleAsset.findUnique({ where: { id: f.a.id } })).deletedAt);
  const detail = await f.service.detail(f.ownerId, t.id, false);
  assert.equal(detail.suggestions[0].kind, 'CITY');
  assert.equal(detail.suggestions[0].manualAction, 'DELETE');
  assert.equal(detail.suggestions[0].status, 'REJECTED');
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 0);
  await f.service.manualAction(f.ownerId, t.id, input, false);
  const history = await f.service.history(f.ownerId, t.id, { limit: 50 }, false);
  assert.equal(history.items.filter((e) => e.action === 'MANUAL_EXECUTED').length, 1);
  assert.ok(history.items.some((e) => e.action === 'PROPOSED'));
  const other = await fixture();
  await assert.rejects(other.service.manualAction(other.ownerId, t.id, input, false), /不存在/);
});

test('manual selection rejects mixed scopes, stale versions and changed retry actions before writing', async () => {
  const f = await fixture();
  const t = await f.task('DELETE'),
    a = await f.proposal(t);
  const input = {
    operationId: randomUUID(),
    action: 'DELETE',
    items: [{ suggestionId: a.id, mediaRevision: 0, rowVersion: 999 }],
  };
  await assert.rejects(f.service.manualAction(f.ownerId, t.id, input, false), /变化/);
  assert.equal((await prisma.eagleAsset.findUnique({ where: { id: f.a.id } })).deletedAt, null);
  await assert.rejects(
    f.service.manualAction(
      f.ownerId,
      t.id,
      { ...input, items: [{ suggestionId: randomUUID(), mediaRevision: 0, rowVersion: 1 }] },
      false,
    ),
    /不存在/,
  );
});

test('manual send failure retries the same independent copy without approving the original location suggestion', async () => {
  const f = await fixture();
  await prisma.eagleAsset.update({
    where: { id: f.a.id },
    data: { originalObjectKey: `users/${f.ownerId}/assets/${f.a.id}/original.png` },
  });
  const { EagleLibraryTransferService } =
    await import('../../apps/api/dist/eagle/eagle-library-transfer.service.js');
  let offline = true,
    copies = 0;
  const transfer = new EagleLibraryTransferService(
    legacyTransferDb,
    {
      copyObject: async () => {
        copies++;
        if (offline) throw new Error('copy offline');
      },
      headObject: async () => ({ ContentLength: 1 }),
    },
    'PHOTO',
  );
  const service = new PhotoAgentService(prisma, {}, transfer);
  const task = await f.task('CITY'),
    suggestion = await f.proposal(task);
  const input = {
    operationId: randomUUID(),
    action: 'SEND_TO_MATERIAL',
    items: [
      { suggestionId: suggestion.id, mediaRevision: f.a.mediaRevision, rowVersion: f.a.rowVersion },
    ],
  };
  await assert.rejects(service.manualAction(f.ownerId, task.id, input, false), /offline/);
  assert.equal((await prisma.eagleAsset.findUnique({ where: { id: f.a.id } })).deletedAt, null);
  assert.equal((await service.detail(f.ownerId, task.id, false)).suggestions[0].status, 'PENDING');
  offline = false;
  const outcome = await service.manualAction(f.ownerId, task.id, input, false);
  assert.equal(outcome.affectedAssetCount, 1);
  const before = copies;
  await service.manualAction(f.ownerId, task.id, input, false);
  assert.equal(copies, before);
  await assert.rejects(
    service.manualAction(f.ownerId, task.id, { ...input, action: 'DELETE' }, false),
    /不一致/,
  );
  assert.equal(await prisma.eaglePhotoLocation.count({ where: { assetId: f.a.id } }), 0);
  assert.equal(
    (await service.detail(f.ownerId, task.id, false)).suggestions[0].manualAction,
    'SEND_TO_MATERIAL',
  );
  const history = await service.history(f.ownerId, task.id, { limit: 50 }, false);
  assert.equal(history.items.filter((e) => e.action === 'MANUAL_EXECUTED').length, 1);
  assert.equal(history.items.filter((e) => e.action === 'MANUAL_FAILED').length, 1);
});

test('manual multi-selection is all-or-nothing for changed or hidden photos and remains separate from prior decisions', async () => {
  const f = await fixture();
  const task = await f.task('DELETE');
  const first = await f.proposal(task);
  const second = await f.proposal(task, { assetId: f.b.id });
  const items = [
    { suggestionId: first.id, mediaRevision: 0, rowVersion: 1 },
    { suggestionId: second.id, mediaRevision: 0, rowVersion: 999 },
  ];
  await assert.rejects(
    f.service.manualAction(
      f.ownerId,
      task.id,
      { operationId: randomUUID(), action: 'DELETE', items },
      false,
    ),
    /变化/,
  );
  assert.equal(
    await prisma.eagleAsset.count({ where: { id: { in: [f.a.id, f.b.id] }, deletedAt: null } }),
    2,
  );
  await assert.rejects(
    f.service.manualAction(
      f.ownerId,
      task.id,
      { operationId: randomUUID(), action: 'DELETE', items: [items[0], items[0]] },
      false,
    ),
    /重复/,
  );
  await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { isPrivate: true } });
  await assert.rejects(
    f.service.manualAction(
      f.ownerId,
      task.id,
      { operationId: randomUUID(), action: 'DELETE', items: [items[0]] },
      false,
    ),
    /不存在/,
  );
  await prisma.eagleAsset.update({ where: { id: f.a.id }, data: { isPrivate: false } });
  await f.service.review(f.ownerId, task.id, first.id, { action: 'REJECT' }, false);
  await f.service.manualAction(
    f.ownerId,
    task.id,
    { operationId: randomUUID(), action: 'DELETE', items: [items[0]] },
    false,
  );
  const history = await f.service.history(f.ownerId, task.id, { limit: 50 }, false);
  assert.ok(history.items.some((e) => e.action === 'REJECTED'));
  assert.ok(history.items.some((e) => e.action === 'MANUAL_EXECUTED'));
});

test('reference allocation is concurrent-safe and immutable, and paging never renumbers older requests', async () => {
  const f = await fixture();
  const tasks = await Promise.all(Array.from({ length: 4 }, () => f.task('DELETE')));
  assert.deepEqual(tasks.map((t) => t.number).sort(), [1, 2, 3, 4]);
  let page = await f.service.tasks(f.ownerId, { limit: 2 }, false);
  assert.deepEqual(
    page.items.map((t) => t.number),
    [4, 3],
  );
  await f.task('DELETE');
  page = await f.service.tasks(f.ownerId, { limit: 2, after: page.next }, false);
  assert.deepEqual(
    page.items.map((t) => t.number),
    [2, 1],
  );
  await assert.rejects(
    prisma.eaglePhotoAgentTask.update({ where: { id: tasks[0].id }, data: { number: 99 } }),
    /immutable/,
  );
  await assert.rejects(f.service.detailByNumber(f.ownerId, 0, false), /无效/);
});

test('a failed original send can be superseded by an explicit manual deletion', async () => {
  const f = await fixture(),
    task = await f.task('SEND_TO_MATERIAL'),
    suggestion = await f.proposal(task);
  await prisma.eaglePhotoAgentSuggestion.update({
    where: { id: suggestion.id },
    data: { status: 'FAILED' },
  });
  await f.service.manualAction(
    f.ownerId,
    task.id,
    {
      operationId: randomUUID(),
      action: 'DELETE',
      items: [{ suggestionId: suggestion.id, mediaRevision: 0, rowVersion: 1 }],
    },
    false,
  );
  assert.equal(
    (await f.service.detail(f.ownerId, task.id, false)).suggestions[0].status,
    'REJECTED',
  );
});
