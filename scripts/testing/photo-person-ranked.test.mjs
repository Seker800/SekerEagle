import { performance } from 'node:perf_hooks';
import console from 'node:console';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as flushEvents } from 'node:timers/promises';
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
let queryCount = 0,
  transactionCount = 0;
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
db.$on('query', (event) => {
  queryCount++;
  if (event.query === 'BEGIN') transactionCount++;
});
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

test('count-sorted unnamed pages and atomic multi-person merge preserve scope and versions', async () => {
  const owner = randomUUID(),
    foreign = randomUUID();
  const accounts = [owner, foreign];
  await db.user.createMany({
    data: accounts.map((id) => ({ id, email: `${id}@example.invalid`, passwordHash: 'synthetic' })),
  });
  try {
    const groups = Array.from({ length: 30 }, (_, i) => ({
      id: randomUUID(),
      ownerId: owner,
      libraryMode: 'PHOTO',
      modelVersion: PHOTO_FACE_MODEL_VERSION,
      prototype: [1, ...Array(127).fill(0)],
      count: i + 1,
    }));
    const outsider = {
      id: randomUUID(),
      ownerId: foreign,
      libraryMode: 'PHOTO',
      modelVersion: PHOTO_FACE_MODEL_VERSION,
      prototype: [1, ...Array(127).fill(0)],
    };
    await db.eaglePhotoPerson.createMany({
      data: [
        ...groups.map((p) => ({
          id: p.id,
          ownerId: p.ownerId,
          libraryMode: p.libraryMode,
          modelVersion: p.modelVersion,
          prototype: p.prototype,
        })),
        outsider,
      ],
    });
    const assets = [],
      faces = [];
    for (const p of groups)
      for (let i = 0; i < p.count; i++) {
        const id = randomUUID();
        assets.push({
          id,
          ownerId: owner,
          libraryMode: 'PHOTO',
          originalName: 'synthetic.jpg',
          displayName: 'synthetic',
          normalizedDisplayName: 'synthetic',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1,
          mediaRevision: 1,
          lifecycleStatus: 'READY',
          originalObjectKey: `synthetic/${id}`,
        });
        faces.push({
          id: randomUUID(),
          ownerId: owner,
          libraryMode: 'PHOTO',
          assetId: id,
          assetRevision: 1,
          personId: p.id,
          modelVersion: PHOTO_FACE_MODEL_VERSION,
          embedding: [1, ...Array(127).fill(0)],
          box: [0.1, 0.1, 0.2, 0.2],
          confidence: 0.99,
        });
      }
    await db.eagleAsset.createMany({ data: assets });
    await db.eaglePhotoFace.createMany({ data: faces });
    // One photo with two current detections is still one photo, and obsolete faces are excluded.
    await db.eaglePhotoFace.createMany({
      data: [
        { ...faces[0], id: randomUUID() },
        { ...faces[0], id: randomUUID(), assetRevision: 0 },
      ],
    });
    const { PhotoManagementService } =
      await import('../../apps/api/dist/photos/photo-management.service.js');
    const service = new PhotoManagementService(db);
    const first = await service.people(owner, false, undefined, 'UNNAMED', 'cards');
    assert.deepEqual(
      first.people.map((p) => p.photoCount),
      Array.from({ length: 24 }, (_, i) => 30 - i),
    );
    assert(first.nextCursor);
    const next = await service.people(owner, false, first.nextCursor, 'UNNAMED', 'cards');
    assert.deepEqual(
      next.people.map((p) => p.photoCount),
      [6, 5, 4, 3, 2, 1],
    );
    assert.equal(next.nextCursor, null);
    assert.equal(new Set([...first.people, ...next.people].map((p) => p.id)).size, 30);
    await assert.rejects(
      service.people(foreign, false, first.nextCursor, 'UNNAMED', 'cards'),
      /游标无效/,
    );
    const target = groups[29].id,
      sources = [groups[28].id, groups[27].id];
    const selection = [target, ...sources].map((id) => ({ id, rowVersion: 1 }));
    await assert.rejects(
      service.mergeSelection(owner, false, target, [
        { id: outsider.id, rowVersion: 1 },
        ...selection,
      ]),
      /不存在/,
    );
    assert.equal(await db.eaglePhotoPerson.count({ where: { ownerId: owner } }), 30);
    await assert.rejects(
      service.mergeSelection(
        owner,
        false,
        target,
        selection.map((p) => ({ ...p, rowVersion: p.id === sources[0] ? 2 : 1 })),
      ),
      /变化/,
    );
    assert.equal(await db.eaglePhotoPerson.count({ where: { ownerId: owner } }), 30);
    await flushEvents();
    queryCount = 0;
    transactionCount = 0;
    const started = performance.now();
    const result = await service.mergeSelection(owner, false, target, selection);
    await flushEvents();
    console.log(
      JSON.stringify({
        batchMerge: {
          selected: 3,
          sql: queryCount,
          transactions: transactionCount,
          ms: performance.now() - started,
          s3: 0,
        },
      }),
    );
    assert(queryCount <= 12, 'batch merge amortizes metadata work');
    assert.equal(transactionCount, 1);
    assert.equal(result.photoCount, 87);
    assert.equal(result.rowVersion, 2);
    assert.equal(await db.eaglePhotoPerson.count({ where: { ownerId: owner } }), 28);
    assert.equal(
      await db.eaglePhotoFace.count({ where: { ownerId: owner, personId: { in: sources } } }),
      0,
    );
    assert.equal(
      await db.eaglePhotoFace.count({
        where: { ownerId: owner, personId: target, userAssigned: true },
      }),
      57,
    );
    assert.equal(
      (await service.people(owner, false, undefined, 'UNNAMED', 'cards')).people[0].id,
      target,
    );
    await assert.rejects(
      service.mergeSelection(owner, false, target, [{ id: target, rowVersion: 2 }]),
      /请选择/,
    );
    await assert.rejects(
      service.mergeSelection(owner, false, target, [
        { id: groups[3].id, rowVersion: 1 },
        { id: groups[4].id, rowVersion: 1 },
      ]),
      /请选择/,
    );
    const hidden = groups[0].id,
      publicSource = groups[2].id,
      unrelated = groups[5].id;
    await service.setPersonPrivacy(owner, hidden, true, 1, false);
    await assert.rejects(
      service.mergeSelection(owner, false, hidden, [
        { id: hidden, rowVersion: 2 },
        { id: publicSource, rowVersion: 1 },
      ]),
      /不存在/,
    );
    const ordered = [publicSource, unrelated].sort();
    await db.eaglePhotoPersonSeparation.create({
      data: { ownerId: owner, libraryMode: 'PHOTO', firstId: ordered[0], secondId: ordered[1] },
    });
    const internal = [hidden, publicSource].sort();
    await db.eaglePhotoPersonSeparation.create({
      data: { ownerId: owner, libraryMode: 'PHOTO', firstId: internal[0], secondId: internal[1] },
    });
    const mixed = await service.mergeSelection(owner, true, hidden, [
      { id: hidden, rowVersion: 2 },
      { id: publicSource, rowVersion: 1 },
    ]);
    assert.equal(mixed.marksAssetsPrivate, true);
    assert.equal(mixed.photoCount, 4);
    assert.equal(
      await db.eaglePhotoFace.count({ where: { personId: hidden, asset: { isPrivate: false } } }),
      0,
    );
    const inherited = [hidden, unrelated].sort();
    assert(
      await db.eaglePhotoPersonSeparation.findUnique({
        where: {
          ownerId_libraryMode_firstId_secondId: {
            ownerId: owner,
            libraryMode: 'PHOTO',
            firstId: inherited[0],
            secondId: inherited[1],
          },
        },
      }),
    );
    const options = await service.people(owner, true, undefined, 'UNNAMED', 'options');
    assert(options.people.every((p) => !('faces' in p) && !('prototype' in p)));
  } finally {
    await db.eaglePhotoPersonSeparation.deleteMany({ where: { ownerId: { in: accounts } } });
    await db.eaglePhotoFace.deleteMany({ where: { ownerId: { in: accounts } } });
    await db.eaglePhotoPerson.deleteMany({ where: { ownerId: { in: accounts } } });
    await db.eagleAsset.deleteMany({ where: { ownerId: { in: accounts } } });
    await db.user.deleteMany({ where: { id: { in: accounts } } });
  }
});
