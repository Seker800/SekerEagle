import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaResourcePool } from './media-resource-pool';

test('NAS and embedding run together, but each resource holds its own single slot until completion', async () => {
  let finishNas!: () => void;
  const held = new Promise<void>((resolve) => {
    finishNas = resolve;
  });
  const errors: unknown[] = [];
  const completed: string[] = [];
  const pool = new MediaResourcePool(
    1,
    () => {},
    (error) => errors.push(error),
  );
  let nasClaims = 0,
    embeddingClaims = 0;
  await pool.fill(
    'NAS',
    async () => (++nasClaims === 1 ? 'nas' : null),
    async () => held,
  );
  await pool.fill(
    'EMBEDDING',
    async () => (++embeddingClaims <= 2 ? 'vector' : null),
    async (job) => {
      completed.push(job);
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  await pool.fill(
    'NAS',
    async () => {
      nasClaims++;
      return 'duplicate';
    },
    async () => {},
  );
  assert.equal(nasClaims, 1);
  assert.deepEqual(completed, ['vector']);
  await pool.fill(
    'EMBEDDING',
    async () => (++embeddingClaims <= 2 ? 'vector' : null),
    async (job) => {
      completed.push(job);
    },
  );
  assert.equal(completed.length, 2);
  finishNas();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.activeCount, 0);
  assert.deepEqual(errors, []);
});

test('claim failures and execution failures release only their own resource and report errors', async () => {
  const errors: unknown[] = [];
  let wakes = 0;
  const pool = new MediaResourcePool(
    1,
    () => {
      wakes++;
    },
    (error) => errors.push(error),
  );
  await assert.rejects(
    pool.fill(
      'NAS',
      async () => {
        throw new Error('claim');
      },
      async () => {},
    ),
  );
  await pool.fill(
    'EMBEDDING',
    async () => 'job',
    async () => {
      throw new Error('run');
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.activeCount, 0);
  assert.equal(errors.length, 1);
  assert.equal(wakes, 1);
});
