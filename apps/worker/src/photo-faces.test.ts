import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, validateFaceResult } from './photo-faces';
test('face model output must be bounded, finite and versioned', () => {
  assert.throws(() => validateFaceResult({ version: 'wrong', faces: [] }), /FACE/);
  assert.throws(
    () =>
      validateFaceResult({
        version: 'yunet-2023mar-sface-2021dec-v1',
        faces: [{ box: [0, 0, 1, 1], confidence: 1, embedding: [NaN] }],
      }),
    /FACE/,
  );
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('obsolete face results complete only the matching lease without publishing faces', async () => {
  const { persistPhotoFaces } = await import('./photo-faces');
  let finished = false;
  const db = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    eagleAsset: { findFirst: async () => null },
    eagleAssetProcessingJob: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        assert.equal(where.id, 'job');
        assert.equal(where.leaseVersion, 4);
        assert.equal(where.status, 'PROCESSING');
        assert.equal(data.status, 'COMPLETED');
        finished = true;
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  await persistPhotoFaces(
    db as never,
    {
      id: 'job',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      assetId: 'removed',
      assetRevision: 2,
      leaseVersion: 4,
    } as never,
    [],
  );
  assert.ok(finished);
});

test('ready face results share a bounded durable transaction while every original lease guard is checked', async () => {
  const { persistPhotoFaces } = await import('./photo-faces');
  let transactions = 0;
  const ids: string[] = [];
  const db = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    eagleAsset: { findFirst: async () => null },
    eagleAssetProcessingJob: {
      updateMany: async ({
        where,
      }: {
        where: { id: string; leaseVersion: number; status: string };
      }) => {
        assert.equal(where.leaseVersion, 4);
        assert.equal(where.status, 'PROCESSING');
        ids.push(where.id);
        return { count: 1 };
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      transactions++;
      return work(db);
    },
  };
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      persistPhotoFaces(
        db as never,
        {
          id: 'job-' + index,
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          assetId: 'removed-' + index,
          assetRevision: 2,
          leaseVersion: 4,
        } as never,
        [],
      ),
    ),
  );
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  assert.equal(
    transactions,
    1,
    'coalesced publications must share one durable commit rather than eight serialized fsyncs',
  );
});
