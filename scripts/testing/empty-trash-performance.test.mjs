import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as flushQueries } from 'node:timers/promises';
import { after, test } from 'node:test';
import console from 'node:console';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';

assertSafeRuntimeTarget({ databaseUrl: process.env.DATABASE_URL, s3Endpoint: process.env.S3_ENDPOINT, s3Bucket: process.env.S3_BUCKET });
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let events = [];
db.$on('query', event => events.push(event));
after(() => db.$disconnect());

for (const mode of ['MATERIAL', 'PHOTO']) {
  test(`${mode}: empty trash schedules the entire selection with constant bindings and one atomic SQL`, async () => {
    const ownerId = randomUUID();
    await db.user.create({data: {id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only'}});
    const cutoff = new Date(Date.now() - 1000);
    const size = 2048;
    try {
      for (let offset = 0; offset < size + 3; offset += 256) {
        await db.eagleAsset.createMany({data: Array.from({length: Math.min(256, size + 3 - offset)}, (_, i) => {
          const position = offset + i;
          return {id: randomUUID(), ownerId, libraryMode: mode, originalName: 'test.jpg', displayName: String(position), normalizedDisplayName: String(position), mimeType: 'image/jpeg', format: 'jpeg', byteSize: 1, originalObjectKey: `users/${ownerId}/assets/${position}/original`, deletedAt: position === size ? null : position === size + 1 ? new Date(cutoff.getTime() + 1) : new Date(cutoff.getTime() - 1), isPrivate: position === size + 2};
        })});
      }
      await flushQueries();
      events = [];
      const result = await new EagleService(db, undefined, mode).emptyTrash(ownerId, false, cutoff);
      await flushQueries();
      const captured = events;
      const maxBindings = Math.max(...captured.map(event => JSON.parse(event.params).length));
      console.log(JSON.stringify({benchmark:'empty-trash',mode,size,sql:captured.length,maxBindings}));
      assert.equal(result.affectedAssetCount, size);
      assert.ok(maxBindings <= 32, `empty-trash must not materialize a selection-sized bind list; observed ${maxBindings}`);
      assert.ok(captured.length <= 3, `one set statement plus BEGIN/COMMIT, observed ${captured.length}`);
      assert.equal(await db.eagleAssetProcessingJob.count({where:{ownerId,libraryMode:mode,kind:'PURGE_ASSET'}}),size);
      assert.equal(await db.eagleAsset.count({where:{ownerId,libraryMode:mode,purgeAfter:{not:null}}}),size);
      assert.equal((await new EagleService(db, undefined, mode).emptyTrash(ownerId,false,cutoff)).affectedAssetCount,0);
    } finally {
      await db.eagleAsset.deleteMany({where:{ownerId}});
      await db.user.delete({where:{id:ownerId}});
    }
  });
}
