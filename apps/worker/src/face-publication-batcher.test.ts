import assert from 'node:assert/strict';
import test from 'node:test';
import { FacePublicationBatcher } from './face-publication-batcher';

test('one rejected publication cannot turn healthy siblings into failed work', async () => {
  const committed: string[] = [];
  const batcher = new FacePublicationBatcher<string>(
    async (values) => {
      if (values.includes('bad')) throw Error('bad row');
      committed.push(...values);
    },
    () => 'owner',
    () => 1,
    0,
  );
  const outcomes = await Promise.allSettled([batcher.enqueue('good'), batcher.enqueue('bad')]);
  assert.equal(outcomes[0]!.status, 'fulfilled');
  assert.equal(outcomes[1]!.status, 'rejected');
  assert.deepEqual(committed, ['good']);
  await batcher.enqueue('after');
  assert.deepEqual(committed, ['good', 'after']);
});

test('publication batches keep owners separate and bound both photo and face counts', async () => {
  const batches: Array<Array<{ owner: string; faces: number }>> = [];
  const batcher = new FacePublicationBatcher<{ owner: string; faces: number }>(
    async (values) => {
      batches.push(values);
    },
    (value) => value.owner,
    (value) => value.faces,
    0,
  );
  await Promise.all(
    [
      { owner: 'a', faces: 80 },
      { owner: 'a', faces: 80 },
      { owner: 'b', faces: 1 },
      { owner: 'b', faces: 1 },
    ].map((value) => batcher.enqueue(value)),
  );
  assert.equal(batches.length, 3);
  for (const batch of batches) {
    assert.ok(batch.length <= 8);
    assert.ok(batch.reduce((n, v) => n + v.faces, 0) <= 128);
    assert.equal(new Set(batch.map((v) => v.owner)).size, 1);
  }
});

test('pending receipts are bounded and overload does not discard accepted work', async () => {
  let committed = 0;
  const batcher = new FacePublicationBatcher<number>(
    async (values) => {
      committed += values.length;
    },
    () => 'owner',
    () => 0,
    0,
  );
  const results = await Promise.allSettled(
    Array.from({ length: 33 }, (_, i) => batcher.enqueue(i)),
  );
  assert.equal(committed, 32);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});
