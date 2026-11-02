import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

test('existing SQL batches in a 60k library publish one hint without per-resource writes', async () => {
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  const owner = randomUUID();
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic' },
    });
    await db.$executeRaw`INSERT INTO "EagleAsset" (id,"ownerId","libraryMode","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","updatedAt")
      SELECT ${owner}||'-'||n,${owner},'PHOTO','scale.jpg','scale','scale','image/jpeg','jpeg',1,'users/'||${owner}||'/scale/'||n,now() FROM generate_series(1,60000) n`;
    await db.$executeRawUnsafe('ANALYZE "EagleAsset"');
    const samples = [];
    // The production executor already publishes bounded SQL batches. Do not
    // replace that contract with an artificial unbounded 60k UPDATE statement.
    for (const count of [1, 512]) {
      for (const enabled of [false, true]) {
        const explain = await db.$transaction(
          async (tx) => {
            // Only this isolated DB test changes the trigger. Restore before commit.
            await tx.$executeRawUnsafe(
              `ALTER TABLE "EagleAsset" ${enabled ? 'ENABLE' : 'DISABLE'} TRIGGER workspace_change_update`,
            );
            const result = await tx.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)
            UPDATE "EagleAsset" a SET "displayName"=${`measured-${enabled}`}
            FROM (SELECT id FROM "EagleAsset" WHERE "ownerId"=${owner} ORDER BY id LIMIT ${count}) s WHERE a.id=s.id`;
            await tx.$executeRawUnsafe(
              'ALTER TABLE "EagleAsset" ENABLE TRIGGER workspace_change_update',
            );
            return result[0]['QUERY PLAN'][0];
          },
          { timeout: 60000 },
        );
        const hint = explain.Triggers?.find((t) => t['Trigger Name'] === 'workspace_change_update');
        assert.equal(hint?.Calls ?? 0, enabled ? 1 : 0);
        samples.push({
          count,
          enabled,
          ms: explain['Execution Time'],
          hintMs: hint?.Time ?? 0,
          sharedBlocks: explain.Plan['Shared Hit Blocks'] + explain.Plan['Shared Read Blocks'],
          walBytes: explain.Plan['WAL Bytes'] ?? 0,
          hintCalls: hint?.Calls ?? 0,
        });
        console.log(JSON.stringify({ benchmark: 'workspace-change-batch', ...samples.at(-1) }));
      }
    }
    const light = await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT capabilities FROM "EagleProcessingWorkerHeartbeat"
      WHERE "heartbeatAt" BETWEEN now()-interval '45 seconds' AND now()
      ORDER BY "heartbeatAt" DESC LIMIT 1`);
    console.log(
      JSON.stringify({
        benchmark: 'workspace-change-hints',
        samples,
        lightRead: light[0]['QUERY PLAN'][0],
        resourceStatementsPerBatch: 1,
        businessTransactionsPerBatch: 1,
        addedResourceWrites: 0,
        s3: 0,
        model: 0,
        limitation:
          'Local synthetic rows; trigger time is included, no production latency claim. DDL is measurement setup only.',
      }),
    );
  } finally {
    // The test owns its scope; shared test fixtures remain untouched.
    await db.eagleAsset.deleteMany({ where: { ownerId: owner } });
    await db.user.delete({ where: { id: owner } });
    await db.$disconnect();
  }
});
