import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbeddingProcessor } from './embedding-job';

const identity = {
  id: 'space',
  model: 'model',
  revision: 'revision',
  dimensions: 2,
  normalized: true,
  instructionVersion: 'image-retrieval-v1',
  preprocessingVersion: 'preview-webp-v1',
};
const job = {
  id: 'job',
  ownerId: 'owner',
  libraryMode: 'PHOTO' as const,
  assetId: 'asset',
  assetRevision: 1,
  leaseVersion: 2,
};
function fixture(stored = false) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async (query: { sql: string }) =>
      query.sql.includes('FROM "EagleAsset"')
        ? [{ id: job.assetId, spaceId: identity.id }]
        : stored
          ? [{ id: 'record' }]
          : [],
    $executeRaw: async () => 1,
    eagleEmbeddingSpace: {
      findMany: async () => {
        calls.push('space-read');
        return [{ ...identity, isCurrent: true }];
      },
    },
    eagleAssetProcessingJob: { updateMany: async () => ({ count: 1 }) },
    eagleAssetEmbedding: { updateMany: async () => ({ count: 1 }) },
  };
  const processor = new EmbeddingProcessor({
    client: {
      $transaction: async (work: (tx: unknown) => unknown) => work(tx),
      eagleAssetEmbedding: {
        upsert: async () => {
          calls.push('record');
          return { id: 'record' };
        },
      },
    } as never,
    identity,
    hasCredentials: true,
    embedImage: async () => {
      calls.push('infer');
      return { embedding: [1, 0] };
    },
    readSource: async () => {
      calls.push('read');
      return Buffer.from('synthetic');
    },
    suggest: async () => {
      calls.push('suggest');
    },
  });
  return { processor, calls };
}

test('one-slot and consecutive inference finish immediately with one model request per image', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) await f.processor.infer(job, 'image/jpeg', {} as never);
  assert.equal(f.calls.filter((call) => call === 'space-read').length, 1);
  assert.equal(f.calls.filter((call) => call === 'infer').length, 4);
  assert.equal(f.calls.filter((call) => call === 'suggest').length, 4);
});

test('stored activation never reads image bytes or calls inference', async () => {
  const f = fixture(true);
  assert.equal(await f.processor.activateStored(job), true);
  assert.deepEqual(f.calls, ['space-read', 'suggest']);
});
