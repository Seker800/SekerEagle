import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { LibraryReadStore } from '../../apps/api/dist/eagle/eagle-memory-store.js';
import { compileSearchPredicate } from '../../apps/api/dist/eagle/eagle-search-predicate.js';
import { buildEagleFilterWhere } from '../../apps/api/dist/eagle/eagle-filter-query.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient();
const ownerId = randomUUID(),
  other = randomUUID();
const store = new LibraryReadStore(db);
const scope = { ownerId, libraryMode: 'PHOTO' };
before(async () => {
  await db.user.createMany({
    data: [ownerId, other].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  await db.eagleAsset.createMany({
    data: Array.from({ length: 40 }, (_, i) => ({
      id: `${ownerId}-${i}`,
      ownerId,
      libraryMode: 'PHOTO',
      originalName: `image-${i}.jpg`,
      displayName: `image_${i}%`,
      normalizedDisplayName: `image_${i}%`,
      mimeType: 'image/jpeg',
      format: 'jpg',
      byteSize: BigInt(i + 1),
      width: i % 3 ? 4000 : null,
      height: 3000,
      rating: i % 6 || null,
      isPrivate: i % 5 === 0,
      originalObjectKey: `users/${ownerId}/assets/${i}/original`,
      libraryAddedAt: new Date(1760000000000 + i * 1000),
      chronologicalAt: new Date(1760000000000 + i * 1000),
    })),
  });
  await db.eaglePhotoMetadata.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      assetId: `${ownerId}-${i}`,
      ownerId,
      libraryMode: 'PHOTO',
      assetRevision: 0,
      processorVersion: 'fixture',
      cameraModel: i % 3 === 0 ? null : i % 3 === 1 ? '' : 'Camera',
    })),
  });
});
after(async () => {
  await db.eagleAsset.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
  await db.eagleLibraryReadState.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, other] } } });
  await db.$disconnect();
});
test('resident predicates match the real SQL adapter across nulls, NOT, relations and pages', async () => {
  const index = await store.synchronize(scope);
  const conditions = [
    { width: { gt: 1000 } },
    { NOT: { width: { gt: 1000 } } },
    { normalizedDisplayName: { contains: 'IMAGE\\_', mode: 'insensitive' } },
    { byteSize: { gt: 20n } },
    { rating: null },
    { NOT: { rating: { not: 2 } } },
    { photoMetadata: { is: { cameraModel: 'Camera' } } },
    { NOT: { photoMetadata: { is: { cameraModel: 'Camera' } } } },
    { photoMetadata: { isNot: { cameraModel: 'Camera' } } },
    ...['EMPTY', 'NOT_EMPTY'].map((operator) =>
      buildEagleFilterWhere(
        {
          version: 2,
          conditions: [
            {
              id: 'g',
              match: 'ALL',
              result: 'MATCH',
              rules: [{ id: 'r', field: 'CAMERA_MODEL', operator }],
            },
          ],
        },
        'PHOTO',
      ),
    ),
  ];
  for (const condition of conditions) {
    const where = { AND: [{ ownerId, libraryMode: 'PHOTO', isPrivate: false }, condition] };
    const expected = await db.$queryRaw(
      Prisma.sql`SELECT asset.id FROM "EagleAsset" asset WHERE ${compileSearchPredicate(where)} ORDER BY asset."chronologicalAt" DESC,asset.id DESC`,
    );
    assert.deepEqual(
      index.page(where, 'chronologicalAt', 'desc', 100, 0),
      expected.map((row) => row.id),
      JSON.stringify(condition, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    assert.equal(index.count(where), expected.length);
    assert.deepEqual(
      index.page(where, 'chronologicalAt', 'desc', 3, 3),
      expected.slice(3, 6).map((row) => row.id),
    );
  }
  assert.deepEqual(index.page({ ownerId: other }, 'chronologicalAt', 'desc', 10, 0), []);
});
test('committed updates are visible, rollback is invisible, and removed relations are refreshed', async () => {
  const before = await store.synchronize(scope);
  const revision = before.revision;
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.eagleAsset.update({ where: { id: `${ownerId}-1` }, data: { rating: 5 } });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal((await store.synchronize(scope)).revision, revision);
  await db.eagleAsset.update({ where: { id: `${ownerId}-1` }, data: { rating: 5 } });
  const after = await store.synchronize(scope);
  assert.ok(BigInt(after.revision) > BigInt(revision));
  assert.equal(after.count({ id: `${ownerId}-1`, rating: 5 }), 1);
  await db.eaglePhotoMetadata.delete({ where: { assetId: `${ownerId}-2` } });
  assert.equal(
    (await store.synchronize(scope)).count({ id: `${ownerId}-2`, photoMetadata: { is: null } }),
    1,
  );
});
test('a fresh reader reconstructs the same result after acknowledged logs are pruned', async () => {
  const current = await store.synchronize(scope);
  const restarted = await new LibraryReadStore(db).synchronize(scope);
  assert.equal(restarted.revision, current.revision);
  assert.deepEqual(
    restarted.page({}, 'chronologicalAt', 'desc', 100, 0),
    current.page({}, 'chronologicalAt', 'desc', 100, 0),
  );
});
