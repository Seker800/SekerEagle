import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { EagleUploadService } from '../../apps/api/dist/eagle/eagle-upload.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

async function asset(db, owner, input) {
  const id = randomUUID();
  await db.eagleAsset.create({
    data: {
      id,
      ownerId: owner,
      libraryMode: input.libraryMode ?? 'PHOTO',
      originalName: 'batch.jpg',
      displayName: 'batch',
      normalizedDisplayName: 'batch',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: BigInt(input.size),
      originalObjectKey: `users/${owner}/assets/${id}/original`,
      lifecycleStatus: 'READY',
      sha256: input.sha256,
      isPrivate: input.isPrivate ?? false,
    },
  });
  return id;
}

test('batch content checks match owner, mode, size and visible privacy in one query', async () => {
  const owner = randomUUID();
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic' },
    });
    const publicHash = 'a'.repeat(64);
    const privateHash = 'b'.repeat(64);
    const materialHash = 'c'.repeat(64);
    await asset(db, owner, { sha256: publicHash, size: 100 });
    await asset(db, owner, { sha256: publicHash, size: 200 });
    await asset(db, owner, { sha256: privateHash, size: 100, isPrivate: true });
    await asset(db, owner, { sha256: materialHash, size: 100, libraryMode: 'MATERIAL' });

    const photos = new EagleUploadService(db, {}, {}, {}, 'PHOTO');
    const items = [
      { contentSha256: 'A'.repeat(64), size: 100 },
      { contentSha256: publicHash, size: 200 },
      { contentSha256: privateHash, size: 100 },
      { contentSha256: materialHash, size: 100 },
      { contentSha256: 'd'.repeat(64), size: 100 },
    ];

    assert.deepEqual(await photos.checkContentBatch(owner, items, false), {
      exists: [true, true, false, false, false],
    });
    assert.deepEqual(await photos.checkContentBatch(owner, items, true), {
      exists: [true, true, true, false, false],
    });
    assert.deepEqual(await photos.checkContentBatch(randomUUID(), items, true), {
      exists: [false, false, false, false, false],
    });
  } finally {
    await db.eagleAsset.deleteMany({ where: { ownerId: owner } });
    await db.user.delete({ where: { id: owner } });
    await db.$disconnect();
  }
});
