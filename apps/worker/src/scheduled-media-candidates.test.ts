import assert from 'node:assert/strict';
import test from 'node:test';
import { createScheduledMediaSelector } from './scheduled-media-candidates';
import type { ClaimFindManyInput } from './job-claim';

test('FIFO fairness belongs to each lane, so reserved background turns still use automatic preferences', async () => {
  const queries: string[] = [];
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        queries.push(sql.text);
        return [];
      },
    } as never,
    () => false,
  );
  const input = (lane: 'INTERACTIVE' | 'BACKGROUND') =>
    ({ where: { lane }, take: 50 }) as ClaimFindManyInput;
  for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < 3; i++) {
      select.invalidate();
      await select(input('INTERACTIVE'));
    }
    select.invalidate();
    await select(input('BACKGROUND'));
  }
  const background = queries
    .filter((sql) => sql.includes('SELECT job.*'))
    .filter((_, index) => index % 4 === 3);
  assert.equal(background.length, 4);
  for (const sql of background.slice(0, 3)) assert.match(sql, /DESC,\s+CASE CASE WHEN/);
  assert.doesNotMatch(background[3]!, /DESC,\s+CASE CASE WHEN/);
  assert.ok(queries.every((sql) => !sql.includes('policy.priority')));
});

test('replacement freshness uses only the completed upload of the current owned media object', async () => {
  let query = '';
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        query = sql.text;
        return [];
      },
    } as never,
    () => false,
  );
  await select({ where: { lane: 'INTERACTIVE' }, take: 50 } as ClaimFindManyInput, 'RECENT');
  assert.match(query, /JOIN "UploadSession" current_upload/);
  assert.match(query, /current_upload\."objectKey"=a\."originalObjectKey"/);
  assert.match(query, /current_upload\."uploaderId"=a\."ownerId"/);
  assert.match(query, /current_upload\."libraryMode"=a\."libraryMode"/);
  assert.match(query, /current_upload\.status='COMPLETED'/);
  assert.match(
    query,
    /GREATEST\(a\."libraryAddedAt",COALESCE\(current_upload\."completedAt",a\."libraryAddedAt"\)\)/,
  );
  assert.doesNotMatch(query, /job\."createdAt">=/);
});

test('reuses a candidate window while revalidating its IDs before every claim', async () => {
  const queries: string[] = [];
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        queries.push(sql.text);
        return [{ id: 'job-1' }];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  const input = { where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput;
  await select(input, 'HISTORY');
  await select(input, 'HISTORY');
  assert.equal(
    queries.filter((sql) => !sql.includes('job.id IN')).length,
    1,
    'a second claim must not scan the whole backlog again',
  );
  assert.ok(
    queries.some((sql) => sql.includes('job.id IN')),
    'cached hints must be revalidated',
  );
});

test('notifications invalidate only the resource that gains work; reconnect and legacy policies clear both', async () => {
  const { invalidateMediaCandidates } = await import('./scheduled-media-candidates');
  let nas = 0,
    embedding = 0;
  const selectors = {
    NAS: {
      invalidate: () => {
        nas++;
      },
    },
    EMBEDDING: {
      invalidate: () => {
        embedding++;
      },
    },
  };
  invalidateMediaCandidates(selectors, 'media-progress');
  invalidateMediaCandidates(selectors, 'EagleTagSemanticBuild');
  assert.equal(nas + embedding, 0);
  invalidateMediaCandidates(selectors, 'media-ready:NAS');
  invalidateMediaCandidates(selectors, 'media-ready:EMBEDDING');
  assert.deepEqual([nas, embedding], [1, 1]);
  for (const payload of [undefined, 'EagleMediaJob', 'EagleTaskPolicy', 'EagleProcessingSetting'])
    invalidateMediaCandidates(selectors, payload);
  assert.deepEqual([nas, embedding], [5, 5]);
});

test('a policy notification during discovery cannot repopulate or publish a stale window', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async () => {
        await held;
        return [{ id: 'stale' }];
      },
    } as never,
    () => false,
  );
  const reading = select({ where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput);
  select.invalidate();
  release();
  assert.deepEqual(await reading, []);
});

test('empty windows expire, retained windows are bounded and supported lane/kind filters stay typed', async (context) => {
  let now = 0,
    reads = 0;
  context.mock.method(Date, 'now', () => now);
  const queries: string[] = [];
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        reads++;
        queries.push(sql.text);
        return [];
      },
    } as never,
    () => true,
    'NAS',
  );
  const input = {
    where: {
      lane: 'MAINTENANCE',
      kind: 'GENERATE_PREVIEW',
      processorVersion: { notIn: ['disabled'] },
    },
    take: 50,
  } as ClaimFindManyInput;
  await select(input);
  await select(input);
  assert.deepEqual({ reads }, { reads: 1 });
  now = 30001;
  await select(input);
  assert.deepEqual({ reads }, { reads: 2 });
  assert.ok(queries.every((sql) => !sql.includes('AND job.kind::text')));
  for (let n = 0; n < 26; n++)
    await select({
      ...input,
      where: { ...input.where, processorVersion: { notIn: [`version-${n}`] } },
    });
  const prior = reads;
  await select(input);
  assert.equal(reads, prior + 1, 'the oldest window was evicted');
});

test('invalidation during validation prevents the old result being published', async () => {
  let reads = 0;
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async () => {
        if (++reads === 2) select.invalidate();
        return [{ id: 'old' }];
      },
    } as never,
    () => false,
  );
  assert.deepEqual(
    await select({
      where: { lane: 'INTERACTIVE', kind: { not: 'GENERATE_AI_TAGS', in: ['GENERATE_THUMBNAIL'] } },
      take: 50,
    } as ClaimFindManyInput),
    [],
  );
});

test('an exhausted positive window refills immediately rather than idling until another resource wakes', async () => {
  let discoveries = 0,
    validations = 0;
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        if (!sql.text.includes('job.id IN')) return [{ id: ++discoveries === 1 ? 'old' : 'next' }];
        validations++;
        return validations === 1 ? [{ id: 'old' }] : validations === 2 ? [] : [{ id: 'next' }];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  const input = { where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput;
  await select(input);
  assert.deepEqual(await select(input), [{ id: 'next' }]);
  assert.equal(discoveries, 2);
});

test('an empty recent cohort is reused between normal wakes but new work invalidates it immediately', async (context) => {
  let now = 0,
    reads = 0;
  context.mock.method(Date, 'now', () => now);
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async () => {
        reads++;
        return [];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  const input = {
    where: { lane: 'BACKGROUND', kind: 'GENERATE_EMBEDDING' },
    take: 50,
  } as ClaimFindManyInput;
  // Preserve both priority/FIFO cohorts, without rescanning the absent recent queue for every old job.
  for (let i = 0; i < 12; i++) {
    now = i * 2000;
    await select(input, 'RECENT');
  }
  assert.deepEqual({ reads }, { reads: 2 });
  select.invalidate();
  await select(input, 'RECENT');
  assert.deepEqual(
    { reads },
    { reads: 3 },
    'new upload/dependency/policy notifications cannot wait for expiry',
  );
});

test('concurrent pipeline claims share discovery and invalidation fences the in-flight result', async () => {
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async () => {
        reads++;
        await held;
        return [];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  const input = { where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput;
  const first = select(input),
    second = select(input);
  assert.deepEqual({ reads }, { reads: 1 });
  select.invalidate();
  release();
  assert.deepEqual(await Promise.all([first, second]), [[], []]);
  await select(input);
  assert.deepEqual({ reads }, { reads: 2 });
});

test('a failed shared discovery is released so a later wake can retry', async () => {
  let reads = 0;
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async () => {
        if (++reads === 1) throw Error('temporary query failure');
        return [];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  const input = { where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput;
  await assert.rejects(select(input), /temporary query failure/);
  assert.deepEqual(await select(input), []);
  assert.equal(reads, 2);
});

test('freshness resolves only uploads inside the priority horizon, never the entire historical upload table', async () => {
  let query = '';
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        query = sql.text;
        return [];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  await select({ where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput);
  assert.match(query, /current_upload\."completedAt">=now\(\)-interval '24 hours'/);
  assert.match(query, /current_upload\."uploaderId"=a\."ownerId"/);
  assert.match(query, /current_upload\."libraryMode"=a\."libraryMode"/);
});

test('remote image selection excludes video before the window and leaves NAS video eligible',async()=>{
 const queries:string[]=[];const client={$queryRaw:async(q:{text:string})=>{queries.push(q.text);return [];}} as never;
 const remote=createScheduledMediaSelector(client,()=>false,'REMOTE_MEDIA');
 await remote({where:{lane:'INTERACTIVE'},take:50} as ClaimFindManyInput);
 assert.match(queries[0]!,/a\."mimeType" LIKE 'image\/%'/);
 const local=createScheduledMediaSelector(client,()=>false,'NAS',()=>['GENERATE_RENDITIONS']);
 await local({where:{lane:'INTERACTIVE'},take:50} as ClaimFindManyInput);
 assert.match(queries.at(-1)!,/NOT \(a\."mimeType" LIKE 'image\/%' AND job\.kind IN/);
});
