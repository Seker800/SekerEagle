import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCompatibleEmbeddingSpace, createEmbeddingSpaceInitializer } from './embedding-space';

const identity = {
  id: 'space-1',
  model: 'model-1',
  revision: 'revision-1',
  dimensions: 1024,
  instructionVersion: 'instruction-1',
  preprocessingVersion: 'preview-1',
  normalized: true,
};
test('space identity is immutable even when dimensions match and lock is held before reading', async () => {
  for (const rows of [
    [{ ...identity, model: 'another-model', isCurrent: true }],
    [{ ...identity, id: 'another-space', isCurrent: true }],
  ]) {
    let locked = false;
    await assert.rejects(
      ensureCompatibleEmbeddingSpace(
        {
          $executeRaw: async () => {
            locked = true;
            return 1;
          },
          eagleEmbeddingSpace: {
            findMany: async () => {
              assert.equal(locked, true);
              return rows;
            },
            create: async () => assert.fail('must not overwrite space'),
          },
        } as never,
        identity,
      ),
      /EMBEDDING_SPACE_INCOMPATIBLE/,
    );
  }
});
test('compatible active space is reused without rewriting model metadata', async () => {
  await ensureCompatibleEmbeddingSpace(
    {
      $executeRaw: async () => 1,
      eagleEmbeddingSpace: { findMany: async () => [{ ...identity, isCurrent: true }] },
    } as never,
    identity,
  );
});

test('stable model initialization is shared across images and retries a failed initialization', async () => {
  let transactions = 0;
  let compatible = false;
  const initialize = createEmbeddingSpaceInitializer(
    {
      $transaction: async (work: (tx: unknown) => Promise<void>) => {
        transactions++;
        return work({
          $executeRaw: async () => 1,
          eagleEmbeddingSpace: {
            findMany: async () => [
              { ...identity, model: compatible ? identity.model : 'changed', isCurrent: true },
            ],
          },
        });
      },
    } as never,
    identity,
  );
  await assert.rejects(initialize, /EMBEDDING_SPACE_INCOMPATIBLE/);
  compatible = true;
  await Promise.all(Array.from({ length: 25 }, () => initialize()));
  await initialize();
  assert.equal(transactions, 2);
});
