import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { log } from 'node:console';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PHOTO_FACE_MODEL_VERSION } from '../../packages/library-core/dist/index.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { PhotoManagementService } from '../../apps/api/dist/photos/photo-management.service.js';
import { PhotoPersonReviewService } from '../../apps/api/dist/photos/photo-person-review.service.js';
import { readPhotoPeopleReview } from '../../apps/api/dist/photos/photo-people-review.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
after(() => db.$disconnect());
const vector = (x, y) => [x, y, ...Array(126).fill(0)];
test('similarity reviews are global, private-scoped, persistent, versioned and survive merges', async () => {
  const owner = randomUUID(),
    other = randomUUID(),
    model = PHOTO_FACE_MODEL_VERSION;
  await db.user.createMany({
    data: [owner, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  const management = new PhotoManagementService(db),
    reviews = new PhotoPersonReviewService(db, management);
  const people = [];
  async function add(prototype, options = {}) {
    const p = await db.eaglePhotoPerson.create({
      data: {
        ownerId: options.ownerId ?? owner,
        id: options.id ?? randomUUID(),
        modelVersion: options.model ?? model,
        prototype,
        name: options.name ?? null,
        marksAssetsPrivate: options.isPrivate ?? false,
      },
    });
    people.push(p);
    const asset = await db.eagleAsset.create({
      data: {
        ownerId: p.ownerId,
        libraryMode: 'PHOTO',
        originalName: 'synthetic.jpg',
        displayName: 'Synthetic',
        normalizedDisplayName: 'synthetic',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        lifecycleStatus: 'READY',
        isPrivate: options.isPrivate ?? false,
        originalObjectKey: `synthetic/${randomUUID()}`,
        mediaRevision: 2,
      },
    });
    await db.eaglePhotoFace.create({
      data: {
        id: randomUUID(),
        ownerId: p.ownerId,
        assetId: asset.id,
        assetRevision: options.stale ? 1 : 2,
        personId: p.id,
        embedding: options.embedding ?? prototype,
        modelVersion: options.model ?? model,
        box: options.box ?? [0.1, 0.1, 0.4, 0.4],
        confidence: options.confidence ?? 0.99,
      },
    });
    if (!options.noPreview)
      await db.eagleAssetRendition.create({
        data: {
          ownerId: p.ownerId,
          libraryMode: 'PHOTO',
          assetId: asset.id,
          kind: 'PREVIEW',
          variant: 'default',
          revision: 2,
          status: 'READY',
          storageKey: `synthetic/${randomUUID()}`,
          mimeType: 'image/jpeg',
          byteSize: 1,
          width: 1600,
          height: 1200,
        },
      });
    return p;
  }
  try {
    const a = await add(vector(1, 0), { id: '00000000-0000-4000-8000-000000000001' }),
      b = await add(vector(0.8, 0.6), {
        id: '00000000-0000-4000-8000-000000000002',
      }),
      c = await add(vector(0, 1), { name: 'Named' });
    const hidden = await add(vector(1, 0), { isPrivate: true }),
      foreign = await add(vector(1, 0), { ownerId: other }),
      stale = await add(vector(1, 0), { stale: true }),
      missing = await add(vector(1, 0), { noPreview: true });
    // More than one anchor page, with a real pair beyond the old first directory page.
    for (let i = 0; i < 20; i++)
      await add([0, 0, ...Array.from({ length: 126 }, (_, j) => (j === i ? 1 : 0))]);
    const lowResolution = await add(vector(1, 0), { box: [0.1, 0.1, 0.02, 0.02] }),
      lowConfidence = await add(vector(1, 0), { confidence: 0.94 }),
      wrongModel = await add(vector(1, 0), { model: 'incompatible-model' });
    const basis = (axis, component = 1, second = 0) =>
      Array.from({ length: 128 }, (_, i) => (i === axis ? component : i === axis + 1 ? second : 0));
    const weakA = await add(basis(100)),
      weakB = await add(basis(100, 0.55, Math.sqrt(1 - 0.55 ** 2)));
    const namedA = await add(basis(102), { name: 'Named A' }),
      namedB = await add(basis(102), { name: 'Named B' });
    const currentFace = await db.eaglePhotoFace.findFirstOrThrow({ where: { personId: a.id } });
    const oldFace = await db.eaglePhotoFace.create({
      data: {
        id: randomUUID(),
        ownerId: owner,
        libraryMode: 'PHOTO',
        personId: a.id,
        assetId: currentFace.assetId,
        assetRevision: 1,
        embedding: a.prototype,
        modelVersion: model,
        box: [0, 0, 1, 1],
        confidence: 1,
      },
    });
    const first = await reviews.suggestions(owner, false);
    assert(
      !first.items
        .flatMap((pair) => [...pair.first.faces, ...pair.second.faces])
        .some((face) => face.id === oldFace.id),
      'stale high-confidence faces must never illustrate a review',
    );
    assert(first.nextCursor);
    assert(
      first.items.some(
        (p) => [p.first.id, p.second.id].includes(a.id) && [p.first.id, p.second.id].includes(b.id),
      ),
    );
    for (const pair of first.items)
      for (const person of [pair.first, pair.second])
        assert(![hidden.id, foreign.id, stale.id, missing.id].includes(person.id));
    const priority = await readPhotoPeopleReview(db, owner, false);
    assert(
      priority.pairs.some(
        (p) => [p.first.id, p.second.id].includes(a.id) && [p.first.id, p.second.id].includes(b.id),
      ),
    );
    // Both read routes use the same evidence rules, with no weaker fallback.
    const excluded = [
      hidden,
      foreign,
      stale,
      missing,
      lowResolution,
      lowConfidence,
      wrongModel,
      weakA,
      weakB,
    ];
    for (const pair of [...first.items, ...priority.pairs]) {
      for (const person of [pair.first, pair.second]) {
        assert(
          !excluded.some((p) => p.id === person.id),
          'unusable or weak evidence must not become a question',
        );
        assert.equal(
          person.faces.length,
          1,
          'display precisely the matching face, not a different large face',
        );
        assert(!person.faces.some((f) => f.id === oldFace.id));
      }
      assert(
        !(
          [pair.first.id, pair.second.id].includes(namedA.id) &&
          [pair.first.id, pair.second.id].includes(namedB.id)
        ),
      );
    }
    assert(!JSON.stringify(priority).includes('embedding'));
    assert(!JSON.stringify(first).includes('prototype'));
    assert(!JSON.stringify(first).includes('embedding'));
    await assert.rejects(reviews.suggestions(other, false, first.nextCursor), /游标无效/);
    await assert.rejects(reviews.suggestions(owner, true, first.nextCursor), /游标无效/);
    const reject = {
      firstId: a.id,
      secondId: b.id,
      firstVersion: 1,
      secondVersion: 1,
      decision: 'DIFFERENT',
    };
    await reviews.decide(owner, false, reject);
    await reviews.decide(owner, false, reject);
    assert.equal(await db.eaglePhotoPersonSeparation.count({ where: { ownerId: owner } }), 1);
    assert(
      !(await new PhotoPersonReviewService(db, management).suggestions(owner, false)).items.some(
        (p) => [p.first.id, p.second.id].includes(a.id) && [p.first.id, p.second.id].includes(b.id),
      ),
    );
    await assert.rejects(
      reviews.decide(owner, false, { ...reject, secondId: foreign.id }),
      /不存在/,
    );
    await assert.rejects(
      reviews.decide(owner, false, { ...reject, secondId: hidden.id }),
      /不存在/,
    );
    await db.eaglePhotoPerson.update({
      where: { id: a.id },
      data: { rowVersion: { increment: 1 } },
    });
    await assert.rejects(reviews.decide(owner, false, { ...reject, decision: 'SAME' }), /变化/);
    await reviews.decide(owner, false, {
      firstId: a.id,
      secondId: c.id,
      firstVersion: 3,
      secondVersion: 1,
      decision: 'SAME',
    });
    assert.equal(await db.eaglePhotoPerson.count({ where: { id: a.id } }), 0);
    const separation = await db.eaglePhotoPersonSeparation.findFirstOrThrow({
      where: { ownerId: owner },
    });
    assert([separation.firstId, separation.secondId].includes(c.id));
    assert([separation.firstId, separation.secondId].includes(b.id));
    const detail = await db.eaglePhotoFace.findMany({ where: { personId: c.id } });
    assert(detail.some((f) => f.userAssigned));
    const beforeReassignment = await db.eaglePhotoPerson.findMany({
      where: { id: { in: [b.id, c.id] } },
    });
    const movedFace = await db.eaglePhotoFace.findFirstOrThrow({
      where: { personId: c.id, assetRevision: 2 },
    });
    await management.reassignFace(owner, movedFace.id, b.id, false);
    for (const before of beforeReassignment) {
      const after = await db.eaglePhotoPerson.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(after.rowVersion, before.rowVersion + 1);
    }
    await assert.rejects(
      reviews.decide(owner, false, {
        firstId: b.id,
        secondId: c.id,
        firstVersion: 2,
        secondVersion: 2,
        decision: 'SAME',
      }),
      /变化/,
    );
    assert.equal((await reviews.summary(owner, false)).named, 3);
    assert.equal(
      (await reviews.summary(owner, false)).unnamed,
      27,
      'stale-only groups are excluded from the count',
    );
    for (let i = 0; i < 25; i++) await add(vector(0, 1), { name: `Named page ${i}` });
    const named = await management.people(owner, false, undefined, 'NAMED');
    assert(named.people.every((p) => p.name !== null));
    assert.equal(named.people.length, 24);
    assert(named.nextCursor);
    const secondNamed = await management.people(owner, false, named.nextCursor, 'NAMED');
    assert.equal(secondNamed.people.length, 4);
    assert.equal(new Set([...named.people, ...secondNamed.people].map((p) => p.id)).size, 28);
    await assert.rejects(management.people(owner, false, named.nextCursor, 'UNNAMED'), /游标/);
    const unnamed = await management.people(owner, false, undefined, 'UNNAMED');
    assert(unnamed.people.every((p) => p.name === null));
    assert(unnamed.people.length <= 24);
    const next = await reviews.suggestions(owner, false, first.nextCursor);
    assert(next);
    assert.equal(await db.eaglePhotoPerson.count({ where: { id: hidden.id } }), 1);
  } finally {
    await db.eaglePhotoPersonSeparation.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eagleAssetRendition.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eaglePhotoFace.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eaglePhotoPerson.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eagleAsset.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  }
});

test('two thousand identities yield bounded recommendations including a target beyond the first 200 directory entries', async () => {
  const ownerId = randomUUID(),
    modelVersion = PHOTO_FACE_MODEL_VERSION,
    count = 2000;
  const records = Array.from({ length: count }, (_, i) => ({
    id:
      i === 0
        ? '00000000-0000-4000-8000-000000000001'
        : i === count - 1
          ? 'ffffffff-ffff-4fff-8fff-ffffffffffff'
          : randomUUID(),
    assetId: randomUUID(),
    prototype:
      i === 0
        ? vector(1, 0)
        : i === count - 1
          ? vector(0.8, 0.6)
          : [0, 0, ...Array.from({ length: 126 }, (_, j) => (j === i % 126 ? 1 : 0))],
    name: i === count - 1 ? 'Last named identity' : null,
  }));
  try {
    await db.user.create({
      data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' },
    });
    await db.eaglePhotoPerson.createMany({
      data: records.map((p) => ({
        id: p.id,
        name: p.name,
        prototype: p.prototype,
        ownerId,
        modelVersion,
      })),
    });
    await db.eagleAsset.createMany({
      data: records.map((p) => ({
        id: p.assetId,
        ownerId,
        libraryMode: 'PHOTO',
        originalName: 'scale.jpg',
        displayName: 'Synthetic scale',
        normalizedDisplayName: 'synthetic scale',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        mediaRevision: 1,
        lifecycleStatus: 'READY',
        originalObjectKey: `synthetic/${p.assetId}`,
      })),
    });
    await db.eagleAssetRendition.createMany({
      data: records.map((p) => ({
        ownerId,
        libraryMode: 'PHOTO',
        assetId: p.assetId,
        kind: 'PREVIEW',
        variant: 'default',
        revision: 1,
        status: 'READY',
        storageKey: `synthetic/${p.assetId}/preview`,
        mimeType: 'image/jpeg',
        byteSize: 1,
        width: 1600,
        height: 1200,
      })),
    });
    await db.eaglePhotoFace.createMany({
      data: records.map((p) => ({
        id: randomUUID(),
        ownerId,
        libraryMode: 'PHOTO',
        assetId: p.assetId,
        assetRevision: 1,
        personId: p.id,
        embedding: p.prototype,
        modelVersion,
        box: [0.1, 0.1, 0.4, 0.4],
        confidence: 0.99,
      })),
    });
    const service = new PhotoPersonReviewService(db, new PhotoManagementService(db));
    const start = performance.now();
    const result = await service.suggestions(ownerId, false);
    const elapsed = performance.now() - start;
    assert(
      result.items.some(
        (p) =>
          [p.first.id, p.second.id].includes(records[0].id) &&
          [p.first.id, p.second.id].includes(records.at(-1).id),
      ),
    );
    assert(result.nextCursor);
    assert(result.items.length <= 32);
    assert((await service.summary(ownerId, false)).unnamed === 1999);
    log(
      JSON.stringify({
        syntheticOnly: true,
        identities: count,
        reviewQueryMs: Number(elapsed.toFixed(2)),
        returnedPairs: result.items.length,
        productionTiming: false,
      }),
    );
  } finally {
    await db.eagleAssetRendition.deleteMany({ where: { ownerId } });
    await db.eaglePhotoFace.deleteMany({ where: { ownerId } });
    await db.eaglePhotoPerson.deleteMany({ where: { ownerId } });
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.user.deleteMany({ where: { id: ownerId } });
  }
});
