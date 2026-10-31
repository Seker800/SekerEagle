import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaOutputAttempt, retireReplacedRenditions } from './media-output-attempt';

function fixture() {
  const records = new Map<
    string,
    { id: string; status: string; availableAt: Date; prefixes: string[] }
  >();
  let created = 0;
  const db = {
    eagleObjectDeletion: {
      create: async ({ data }: { data: { availableAt: Date; prefixes: string[] } }) => {
        const row = { ...data, id: `receipt-${++created}`, status: 'PENDING' };
        records.set(row.id, row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; status: string } }) => {
        const row = records.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        records.delete(row.id);
        return { count: 1 };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: { availableAt: Date };
      }) => {
        const row = records.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  const asset = { ownerId: 'owner', libraryMode: 'PHOTO' as const, id: 'asset', mediaRevision: 1 };
  return {
    db,
    records,
    count: () => created,
    make: (kind: 'renditions' | 'pyramids' = 'renditions') =>
      new MediaOutputAttempt(db as never, asset, kind),
  };
}

test('late and retried writers for one media revision receive disjoint immutable output namespaces', () => {
  const f = fixture(),
    older = f.make(),
    newer = f.make();
  assert.notEqual(older.key('preview.webp'), newer.key('preview.webp'));
  assert.match(
    older.key('preview.webp'),
    /^users\/owner\/assets\/asset\/renditions\/1\/attempts\//,
  );
  assert.notEqual(f.make('pyramids').prefix, f.make('pyramids').prefix);
  assert.equal(f.count(), 0, 'metadata-only work must not create storage intents');
  assert.throws(() => older.key('../original'), /INVALID_MEDIA_OUTPUT_KEY/);
});

test('an output attempt persists exactly one cleanup intent before writes and consumes it in publication', async () => {
  const f = fixture(),
    attempt = f.make();
  await attempt.prepare();
  await attempt.prepare();
  assert.equal(f.count(), 1);
  assert.deepEqual([...f.records.values()][0]!.prefixes, [attempt.prefix]);
  await attempt.publish(f.db as never);
  await attempt.finish(true);
  assert.equal(f.records.size, 0);
});

test('failed output publication accelerates only its own still-pending cleanup', async () => {
  const f = fixture(),
    attempt = f.make();
  await attempt.prepare();
  await attempt.finish(false);
  assert([...f.records.values()][0]!.availableAt.getTime() <= Date.now());
  const cleaned = f.make();
  await cleaned.prepare();
  f.records.delete('receipt-2');
  await assert.rejects(cleaned.publish(f.db as never), /MEDIA_OUTPUT_PUBLICATION_EXPIRED/);
  await cleaned.finish(false);
  assert.equal(
    f.count(),
    2,
    'an ambiguous committed publication must never recreate a deletion intent',
  );
});

test('replacement retirement reads one scoped batch and never deletes an unchanged output', async () => {
  let reads = 0;
  const retired: unknown[] = [];
  const asset = { id: 'asset', ownerId: 'owner', libraryMode: 'PHOTO' as const, mediaRevision: 1 };
  const tx = {
    eagleAssetRendition: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        reads++;
        assert.equal(where.ownerId, 'owner');
        assert.equal(where.libraryMode, 'PHOTO');
        assert.equal(where.assetId, 'asset');
        return [
          { kind: 'PREVIEW', variant: 'default', storageKey: 'users/owner/old.webp' },
          { kind: 'THUMBNAIL', variant: '512', storageKey: 'users/owner/current.webp' },
        ];
      },
    },
    eagleObjectDeletion: {
      create: async ({ data }: { data: unknown }) => {
        retired.push(data);
      },
    },
  };
  await retireReplacedRenditions(tx as never, asset, [
    { kind: 'PREVIEW', storageKey: 'users/owner/new.webp' },
    { kind: 'THUMBNAIL', variant: '512', storageKey: 'users/owner/current.webp' },
  ] as never);
  assert.equal(reads, 1);
  assert.deepEqual(retired, [
    { ownerId: 'owner', libraryMode: 'PHOTO', objectKeys: ['users/owner/old.webp'], prefixes: [] },
  ]);
});

test('metadata-only attempts and a failed intent creation do not schedule object deletion', async () => {
  const f = fixture(),
    attempt = f.make();
  await attempt.publish(f.db as never);
  await attempt.finish(false);
  assert.equal(f.count(), 0);
  const broken = new MediaOutputAttempt(
    {
      eagleObjectDeletion: {
        create: async () => {
          throw new Error('database unavailable');
        },
      },
    } as never,
    { id: 'asset', ownerId: 'owner', libraryMode: 'PHOTO', mediaRevision: 1 },
    'renditions',
  );
  await assert.rejects(broken.prepare(), /database unavailable/);
  await broken.finish(false);
});
