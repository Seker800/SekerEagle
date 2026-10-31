import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { PrismaClient, Prisma } from '@prisma/client';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient(),
  ownerId = randomUUID();
try {
  await prisma.user.create({
    data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'disabled-test-only' },
  });
  for (const mode of ['MATERIAL', 'PHOTO'])
    await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","lifecycleStatus","libraryAddedAt","chronologicalAt","updatedAt")
    SELECT ${mode}||'-'||g::text,${ownerId},${mode}::"LibraryMode",'scale.jpg','scale '||g,'scale '||g,'image/jpeg','jpeg',1024,${ownerId}||'/'||${mode}||'/'||g,'READY',now()-g*INTERVAL '1 second',now()-g*INTERVAL '1 second',now() FROM generate_series(1,100000) g
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EaglePhotoMetadata" ("assetId","ownerId","libraryMode","assetRevision","processorVersion","capturedAt","cameraModel","lensModel",latitude,longitude)
    SELECT 'PHOTO-'||g::text,${ownerId},'PHOTO',0,'synthetic-scale',now()-g*INTERVAL '1 second','camera-'||(g%10),'lens-'||(g%5),CASE WHEN g%2=0 THEN 31.23 ELSE NULL END,CASE WHEN g%2=0 THEN 121.47 ELSE NULL END FROM generate_series(1,100000) g
  `);
  await prisma.$executeRaw`ANALYZE "EagleAsset"`;
  await prisma.$executeRaw`ANALYZE "EaglePhotoMetadata"`;
  const materials = new EagleService(prisma, undefined, 'MATERIAL'),
    photos = new EagleService(prisma, undefined, 'PHOTO');
  assert.equal(await prisma.eagleAsset.count({ where: { ownerId, libraryMode: 'PHOTO' } }), 100000);
  assert.equal(
    await prisma.eagleAsset.count({ where: { ownerId, libraryMode: 'MATERIAL' } }),
    100000,
  );
  const measurements = [];
  for (const [name, service, query, budgetP95Ms] of [
    ['material-list', materials, { limit: 40 }, 250],
    ['photo-timeline', photos, { limit: 40 }, 250],
    ['photo-camera-gps', photos, { limit: 40, cameraModel: 'camera-2', gps: 'WITH' }, 500],
  ]) {
    const timings = [];
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      const result = await service.listAssets(ownerId, query);
      timings.push(performance.now() - start);
      assert.equal(result.items.length, 40);
      assert.ok(
        result.items.every(
          (asset) => asset.libraryMode === (name === 'material-list' ? 'MATERIAL' : 'PHOTO'),
        ),
      );
    }
    timings.sort((a, b) => a - b);
    const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
    measurements.push({ name, p95Ms, budgetP95Ms });
    assert.ok(p95Ms <= budgetP95Ms, `${name} exceeded local test budget`);
  }
  const first = await photos.listAssets(ownerId, { limit: 40 }),
    second = await photos.listAssets(ownerId, { limit: 40, cursor: first.nextCursor });
  assert.ok(!first.items.some((a) => second.items.some((b) => a.id === b.id)));
  await mkdir('.omx/artifacts', { recursive: true });
  await writeFile(
    '.omx/artifacts/photo-library-scale.json',
    JSON.stringify({ assetsPerMode: 100000, metadataRows: 100000, measurements }, null, 2),
  );
  process.stdout.write(`Dual 100k scale checks passed: ${JSON.stringify(measurements)}\n`);
} finally {
  await prisma.$disconnect();
}
