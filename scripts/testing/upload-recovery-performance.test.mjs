import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleUploadRecoveryService } from '../../apps/api/dist/eagle/eagle-upload-recovery.service.js';
import { observePrismaAdapter } from './database-query-probe.mjs';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

test('empty replacement cleanup reads pending entries rather than 120k completed upload history', async () => {
  const owner = randomUUID();
  let captured;
  const db = new PrismaClient({
    adapter: observePrismaAdapter(({ query, params }) => {
      if (query.startsWith('SELECT') && query.includes('FROM "public"."EagleUploadSessionState"'))
        captured = { query, args: JSON.parse(params) };
    }),
  });
  const deleted = [];
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic' },
    });
    await db.$executeRaw`INSERT INTO "UploadSession" (id,"uploaderId","libraryMode",status,"originalName","mimeType",size,"objectKey","multipartUploadId","updatedAt")
      SELECT ${owner}||'-'||n,${owner},CASE WHEN n%2=0 THEN 'MATERIAL'::"LibraryMode" ELSE 'PHOTO'::"LibraryMode" END,'COMPLETED','history.jpg','image/jpeg',1,'users/'||${owner}||'/history/'||n,'synthetic',now() FROM generate_series(1,120000) n`;
    await db.$executeRaw`INSERT INTO "EagleUploadSessionState" ("uploadSessionId","ownerId","libraryMode","updatedAt") SELECT id,${owner},"libraryMode",now() FROM "UploadSession" WHERE "uploaderId"=${owner}`;
    await db.$executeRaw`INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","lifecycleStatus","updatedAt")
      SELECT ${owner}||'-asset-'||n,${owner},CASE WHEN n%2=0 THEN 'MATERIAL'::"LibraryMode" ELSE 'PHOTO'::"LibraryMode" END,'history.jpg','history','history','image/jpeg','jpeg',1,'users/'||${owner}||'/assets/history/'||n,'READY',now() FROM generate_series(1,120000) n`;
    await db.$executeRawUnsafe('ANALYZE "EagleUploadSessionState"');
    await db.$executeRawUnsafe('ANALYZE "EagleAsset"');
    for (const mode of ['MATERIAL', 'PHOTO']) {
      const recovery = new EagleUploadRecoveryService(
        db,
        { recoverUploadSession: async () => assert.fail('completed history must not recover') },
        { finalizeUpload: async () => assert.fail('no unfinished uploads') },
        { deleteObject: async (key) => deleted.push(key) },
        mode,
      );
      captured = undefined;
      await recovery.recoverPendingFinalizations();
      assert.ok(captured, 'measure the SQL issued by the actual production recovery service');
      const plan = await db.$queryRawUnsafe(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + captured.query,
        ...captured.args,
      );
      const root = plan[0]['QUERY PLAN'][0].Plan;
      const blocks = root['Shared Hit Blocks'] + root['Shared Read Blocks'];
      console.log(
        JSON.stringify({
          benchmark: 'empty-upload-replacement-cleanup',
          mode,
          history: 120000,
          blocks,
          plan: root,
        }),
      );
      assert.ok(blocks < 64, `${mode}: idle cleanup read ${blocks} blocks with no pending entries`);
      const id = `${owner}-${mode === 'MATERIAL' ? 2 : 1}`;
      const asset = `${owner}-${mode}-replacement`;
      const key = `users/${owner}/assets/${asset}/retired`;
      await db.eagleAsset.create({
        data: {
          id: asset,
          ownerId: owner,
          libraryMode: mode,
          originalName: 'replacement.jpg',
          displayName: 'replacement',
          normalizedDisplayName: 'replacement',
          mimeType: 'image/jpeg',
          format: 'jpeg',
          byteSize: 1n,
          originalObjectKey: `users/${owner}/assets/${asset}/original`,
          lifecycleStatus: 'READY',
        },
      });
      await db.eagleUploadSessionState.update({
        where: { uploadSessionId: id },
        data: { replacementAssetId: asset, retiredObjectKeys: [key] },
      });
      await recovery.recoverPendingFinalizations();
      assert.ok(deleted.includes(key), `${mode}: real pending cleanup must still run`);
      assert.deepEqual(
        (await db.eagleUploadSessionState.findUnique({ where: { uploadSessionId: id } }))
          .retiredObjectKeys,
        [],
      );
    }
    assert.equal(deleted.length, 2);
  } finally {
    await db.eagleUploadSessionState.deleteMany({ where: { ownerId: owner } });
    await db.uploadSession.deleteMany({ where: { uploaderId: owner } });
    await db.eagleAsset.deleteMany({ where: { ownerId: owner } });
    await db.user.delete({ where: { id: owner } });
    await db.$disconnect();
  }
});
