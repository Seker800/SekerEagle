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

test('a slow embedding claim does not block repeated NAS work and cannot overfill the reserved slot', async () => {
  let resolve!: (value: string | null) => void;
  const slow = new Promise<string | null>((done) => {
    resolve = done;
  });
  const pool = new MediaResourcePool(
    1,
    () => {},
    () => {},
  );
  const claiming = pool.fill(
    'EMBEDDING',
    () => slow,
    async () => {},
  );
  let completed = 0;
  for (let i = 0; i < 3; i++) {
    await pool.fill(
      'NAS',
      async () => 'nas',
      async () => {
        completed++;
      },
    );
    await new Promise((done) => setImmediate(done));
  }
  await pool.fill(
    'EMBEDDING',
    async () => {
      throw Error('must not issue a concurrent claim');
    },
    async () => {},
  );
  assert.equal(completed, 3);
  assert.equal(pool.active('EMBEDDING'), 1);
  resolve(null);
  await claiming;
  assert.equal(pool.activeCount, 0);
});

test('a wake during an in-flight claim is replayed if that claim returns empty, without idle polling loops', async () => {
  let resolve!: (value: string | null) => void;
  const delayed = new Promise<string | null>((done) => {
    resolve = done;
  });
  let wakes = 0;
  const pool = new MediaResourcePool(
    1,
    () => {
      wakes++;
    },
    () => {},
  );
  const filling = pool.fill(
    'EMBEDDING',
    () => delayed,
    async () => {},
  );
  await pool.fill(
    'EMBEDDING',
    async () => {
      throw Error('slot already reserved');
    },
    async () => {},
  );
  resolve(null);
  await filling;
  assert.equal(wakes, 1, 'the notification must not be lost when discovery is invalidated');
  await pool.fill(
    'EMBEDDING',
    async () => null,
    async () => {},
  );
  assert.equal(wakes, 1, 'an ordinary empty queue must not schedule a busy loop');
});

test('two embedding requests may overlap IO, with bounded reservations and unchanged NAS limit', async () => {
  let release!: () => void;
  const held = new Promise<void>((done) => { release = done; });
  const pool = new MediaResourcePool(1, () => {}, () => {}, 2);
  let claims = 0;
  const claim = async () => ++claims;
  await Promise.all([pool.fill('EMBEDDING', claim, async () => held), pool.fill('EMBEDDING', claim, async () => held)]);
  assert.equal(pool.active('EMBEDDING'), 2);
  assert.equal(claims, 2);
  await pool.fill('EMBEDDING', claim, async () => held);
  await pool.fill('NAS', claim, async () => held);
  assert.equal(pool.active('NAS'), 1);
  assert.equal(claims, 3);
  release();
  await new Promise((done) => setImmediate(done));
  assert.equal(pool.activeCount, 0);
});
