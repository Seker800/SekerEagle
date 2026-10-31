import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { PHOTO_FACE_MODEL_VERSION } from '../../packages/library-core/dist/index.js';
import { PhotoPersonReviewService } from '../../apps/api/dist/photos/photo-person-review.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
after(() => db.$disconnect());
test('all ranked waves retain weak matches and scope while decisions stay excluded', async () => {
  const owner = randomUUID(),
    other = randomUUID();
  await db.user.createMany({
    data: [owner, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic',
    })),
  });
  const people = [];
  async function add(index, ownerId = owner, isPrivate = false) {
    const id = randomUUID(),
      assetId = randomUUID();
    const vector = Array.from({ length: 128 }, (_, i) => (i === index ? 1 : 0));
    await db.eaglePhotoPerson.create({
      data: {
        id,
        ownerId,
        modelVersion: PHOTO_FACE_MODEL_VERSION,
        prototype: vector,
        marksAssetsPrivate: isPrivate,
      },
    });
    await db.eagleAsset.create({
      data: {
        id: assetId,
        ownerId,
        libraryMode: 'PHOTO',
        originalName: 'test.jpg',
        displayName: 'test',
        normalizedDisplayName: 'test',
        mimeType: 'image/jpeg',
        format: 'jpeg',
        byteSize: 1,
        lifecycleStatus: 'READY',
        isPrivate,
        originalObjectKey: `synthetic/${assetId}`,
        mediaRevision: 1,
      },
    });
    await db.eagleAssetRendition.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId,
        kind: 'PREVIEW',
        variant: 'default',
        revision: 1,
        status: 'READY',
        storageKey: `synthetic/${assetId}`,
        mimeType: 'image/jpeg',
        byteSize: 1,
        width: 500,
        height: 500,
      },
    });
    await db.eaglePhotoFace.create({
      data: {
        id: randomUUID(),
        ownerId,
        libraryMode: 'PHOTO',
        assetId,
        assetRevision: 1,
        personId: id,
        modelVersion: PHOTO_FACE_MODEL_VERSION,
        embedding: vector,
        box: [0.1, 0.1, 0.02, 0.02],
        confidence: 0.92,
      },
    });
    return id;
  }
  try {
    for (let i = 0; i < 18; i++) people.push(await add(i));
    const hidden = await add(18, owner, true),
      foreign = await add(19, other);
    const [firstId, secondId] = [people[0], people[1]].sort();
    await db.eaglePhotoPersonSeparation.create({
      data: { ownerId: owner, libraryMode: 'PHOTO', firstId, secondId },
    });
    const service = new PhotoPersonReviewService(db, {});
    const keys = new Set();
    let cursor;
    for (let i = 0; i < 50; i++) {
      const page = await service.suggestions(owner, false, cursor);
      for (const item of page.items) {
        assert(!keys.has(item.key), 'each pair is traversed once');
        keys.add(item.key);
        assert(![hidden, foreign].includes(item.first.id));
        assert(![hidden, foreign].includes(item.second.id));
        assert.equal(item.first.faces.length, 1);
        assert.equal(item.second.faces.length, 1);
      }
      if (!page.nextCursor) {
        cursor = undefined;
        break;
      }
      cursor = page.nextCursor;
      await assert.rejects(service.suggestions(other, false, cursor), /游标无效/);
    }
    assert.equal(cursor, undefined, 'traversal ends');
    assert.equal(keys.size, 152, 'all 153 pairs except the explicit different-person decision');
    assert(!keys.has([firstId, secondId].join(':')));
    const decisions = [];
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const [a, b] = [people[i], people[j]].sort();
        decisions.push({ ownerId: owner, libraryMode: 'PHOTO', firstId: a, secondId: b });
      }
    }
    await db.eaglePhotoPersonSeparation.createMany({ data: decisions, skipDuplicates: true });
    let emptyCursor;
    let ended = false;
    for (let i = 0; i < 10; i++) {
      const page = await service.suggestions(owner, false, emptyCursor);
      assert.deepEqual(page.items, []);
      if (!page.nextCursor) {
        ended = true;
        break;
      }
      emptyCursor = page.nextCursor;
    }
    assert(ended, 'all decided pairs end without endless empty waves');
  } finally {
    await db.eaglePhotoPersonSeparation.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eagleAssetRendition.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eaglePhotoFace.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eaglePhotoPerson.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.eagleAsset.deleteMany({ where: { ownerId: { in: [owner, other] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  }
});
