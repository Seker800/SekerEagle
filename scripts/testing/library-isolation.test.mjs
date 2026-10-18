import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());

async function isolated(run) {
  const rollback = new Error('rollback successful test transaction');
  try {
    await prisma.$transaction(async (tx) => {
      const ownerId = randomUUID();
      await tx.user.create({ data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'test-only' } });
      await run(tx, ownerId);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function asset(tx, ownerId, mode) {
  const id = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "EagleAsset" (id, "ownerId", "libraryMode", "originalName", "displayName", "normalizedDisplayName", "mimeType", format, "byteSize", "originalObjectKey", "updatedAt")
    VALUES (${id}, ${ownerId}, ${mode}::"LibraryMode", 'sample.jpg', 'sample', 'sample', 'image/jpeg', 'jpeg', 1, ${`users/${ownerId}/assets/${id}/sample.jpg`}, now())
  `);
  return id;
}

async function tag(tx, ownerId, mode) {
  const id = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "EagleManualTag" (id, "ownerId", "libraryMode", name, "normalizedName", "updatedAt")
    VALUES (${id}, ${ownerId}, ${mode}::"LibraryMode", 'shared-name', 'shared-name', now())
  `);
  return id;
}

test('same owner can keep identical content and tag names independently in two libraries', () => isolated(async (tx, ownerId) => {
  const material = await asset(tx, ownerId, 'MATERIAL');
  const photo = await asset(tx, ownerId, 'PHOTO');
  assert.notEqual(material, photo);
  await tag(tx, ownerId, 'MATERIAL');
  await tag(tx, ownerId, 'PHOTO');
  const rows = await tx.$queryRaw(Prisma.sql`SELECT DISTINCT "libraryMode" FROM "EagleManualTag" WHERE "ownerId" = ${ownerId}`);
  assert.equal(rows.length, 2);
}));

test('database rejects a photo linked to a material tag for the same owner', () => isolated(async (tx, ownerId) => {
  const photo = await asset(tx, ownerId, 'PHOTO');
  const materialTag = await tag(tx, ownerId, 'MATERIAL');
  await assert.rejects(() => tx.$executeRaw(Prisma.sql`
    INSERT INTO "EagleAssetManualTag" ("ownerId", "libraryMode", "assetId", "tagId")
    VALUES (${ownerId}, 'PHOTO'::"LibraryMode", ${photo}, ${materialTag})
  `), /foreign key/i);
}));

test('database rejects changing the mode of an existing resource', () => isolated(async (tx, ownerId) => {
  const photo = await asset(tx, ownerId, 'PHOTO');
  await assert.rejects(() => tx.$executeRaw(Prisma.sql`
    UPDATE "EagleAsset" SET "libraryMode" = 'MATERIAL' WHERE id = ${photo}
  `), /immutable/i);
}));

test('legacy writes without a mode remain material', () => isolated(async (tx, ownerId) => {
  const row = await tx.eagleAsset.create({ data: {
    ownerId, originalName: 'old.jpg', displayName: 'old', normalizedDisplayName: 'old', mimeType: 'image/jpeg', format: 'jpeg', byteSize: 1,
    originalObjectKey: `users/${ownerId}/assets/${randomUUID()}/old.jpg`,
  } });
  const [stored] = await tx.$queryRaw(Prisma.sql`SELECT "libraryMode" FROM "EagleAsset" WHERE id = ${row.id}`);
  assert.equal(stored.libraryMode, 'MATERIAL');
}));
